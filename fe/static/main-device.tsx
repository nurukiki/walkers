import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.ts';
import type { Device, DeviceEvent, Experience, Feedback, Id, Style } from './api.ts';
import { createAnalysisTask } from './analysis.ts';
import { takePhoto, useCamera } from './camera.ts';
import { FramingGuide, useFraming } from './camera-setup.tsx';
import { record, SideRecording } from './recording.ts';
import { Button, Buttons, Code, Detail, Layout, Link, LivePreview, Notice, Select } from './layout.tsx';
import { Results } from './results.tsx';
import { useAction, useDeviceSocket } from './session.ts';

type Screen = 'login' | 'pair' | 'camera' | 'record' | 'finishing' | 'recorded' | 'walking' |
  'style' | 'photo' | 'checking' | 'fashion' | 'result' | 'saved';
interface Capture {
  id: Id;
  media: ReturnType<typeof record>;
  side: SideRecording;
  abort: AbortController;
  frontUploaded: boolean;
}
interface Cancelled {
  id: Id;
  closing?: Promise<boolean>;
}
const mainRole = '메인 · 정면';

export function MainDevice({ onBack, onLogin }: { onBack: () => void; onLogin: () => void }) {
  const [screen, setScreen] = useState<Screen>('login');
  const [experience, setExperience] = useState<Experience>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [peerReady, setSideReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [canCancelStart, setCanCancelStart] = useState(false);
  const [recordingStart, setRecordingStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [styles, setStyles] = useState<Style[]>([]);
  const [styleId, setStyleId] = useState('');
  const [countdown, setCountdown] = useState<number>();
  const [qualityRejected, setQualityRejected] = useState(false);
  const [walkingResult, setWalkingResult] = useState<Feedback>();
  const [fashionResult, setFashionResult] = useState<Feedback>();
  const [saved, setSaved] = useState(false);
  const [devicesError, setDevicesError] = useState(false);
  const camera = useCamera('front');
  const action = useAction();
  const video = useRef<HTMLVideoElement>(null);
  const framing = useFraming(video, 'front', screen === 'camera' ? camera.stream : null);
  const capture = useRef<Capture>(null);
  const cancelled = useRef<Cancelled>(null);
  const walkTask = useRef<ReturnType<typeof createAnalysisTask>>(null);
  const fashionTask = useRef<ReturnType<typeof createAnalysisTask>>(null);
  const photoAbort = useRef<AbortController>(null);
  const lifetime = useRef<AbortController>(null);
  const experienceId = experience?.experience_id;

  function onMessage(event: DeviceEvent) {
    if ('camera_view' in event && event.camera_view === 'side') {
      if (event.type === 'camera_ready') setSideReady(true);
      if (event.type === 'camera_closed' || event.type === 'device_disconnected') {
        setSideReady(false);
        setDevices((previous) => previous.map((device) => device.camera_view === 'side' ? { ...device, status: 'disconnected' } : device));
      }
      const current = capture.current;
      if (current && ['camera', 'record', 'finishing'].includes(screen)) {
        const failure = current.side.accept(event);
        if (failure) discardCapture(failure.message);
        else if (event.type === 'device_disconnected' && !current.side.hasUpload) {
          discardCapture('측면 촬영을 확인할 수 없어요. 서브 기기를 다시 연결한 뒤 촬영해 주세요.');
        }
      }
    }
  }

  const socket = useDeviceSocket(screen === 'saved' ? undefined : experienceId, onMessage);
  const socketReady = socket.state === 'open';

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      photoAbort.current?.abort();
      walkTask.current?.cancel();
      fashionTask.current?.cancel();
      capture.current?.abort.abort();
      capture.current?.media.cancel();
    };
  }, []);

  useEffect(() => {
    if (screen !== 'login') return;
    let active = true;
    void action.run(async () => {
      try { await api.me(); }
      catch (err) {
        if (err instanceof ApiError && [401, 403].includes(err.status)) return;
        if (active) throw err;
        return;
      }
      if (!active) return;
      const created = await api.createExperience();
      if (active && !lifetime.current?.signal.aborted) {
        setExperience(created);
        setScreen('pair');
      }
    });
    return () => { active = false; };
  }, [screen]);

  useEffect(() => {
    if (experienceId === undefined || !['pair', 'camera', 'record', 'finishing'].includes(screen)) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await api.devices(experienceId);
        if (active) {
          setDevices(response);
          setDevicesError(false);
        }
      } catch { if (active) setDevicesError(true); }
    };
    void refresh();
    const timer = setInterval(refresh, 2400);
    return () => { active = false; clearInterval(timer); };
  }, [experienceId, screen]);

  useEffect(() => {
    if (!socketReady) { setSideReady(false); return; }
    if (cancelled.current) socket.send({ type: 'recording_cancel', recording_id: cancelled.current.id });
    socket.send({ type: 'camera_status_request' });
  }, [socketReady, socket.send]);

  useEffect(() => {
    if (!socketReady || screen !== 'camera' || starting || peerReady) return;
    const refresh = () => {
      // The side may have been offline when the first cancellation was sent.
      if (cancelled.current) socket.send({ type: 'recording_cancel', recording_id: cancelled.current.id });
      socket.send({ type: 'camera_status_request' });
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [peerReady, socketReady, screen, socket.send, starting]);

  useEffect(() => {
    if (screen !== 'camera' || starting) return;
    if (socketReady) socket.send({
      type: framing.confirmed ? 'camera_ready' : 'camera_closed',
      camera_view: 'front',
    });
  }, [framing.confirmed, screen, socketReady, socket.send, starting]);

  useEffect(() => {
    if (screen !== 'record') return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - recordingStart) / 1000)), 300);
    return () => clearInterval(timer);
  }, [recordingStart, screen]);

  const error = (message = action.error) => message && <Notice role="alert">{message}</Notice>;
  const linkError = (experience && !socketReady) || devicesError
    ? <Notice role="status">기기 연결을 확인하고 있어요. 연결이 복구되면 다시 시도해 주세요.</Notice> : null;
  const preview = camera.stream ? <LivePreview stream={camera.stream} videoRef={video} label="정면 카메라 미리보기" /> : undefined;

  function closeCancelled(item: Cancelled) {
    item.closing ??= api.stop(item.id, AbortSignal.timeout(10000)).then(
      () => true,
      () => { item.closing = undefined; return false; },
    );
    return item.closing;
  }

  function queueCancel(id: Id) {
    const item = { id };
    cancelled.current = item;
    socket.send({ type: 'recording_cancel', recording_id: id });
    void closeCancelled(item);
  }

  function discardCapture(message: string) {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    current.abort.abort();
    current.media.cancel();
    queueCancel(current.id);
    setSideReady(false);
    framing.confirm(false);
    setCanCancelStart(false);
    setScreen('camera');
    action.setError(message);
  }

  async function startRecording() {
    const stream = camera.stream;
    if (experienceId === undefined || !stream || !peerReady || !socketReady) return;
    const checkFront = () => {
      if (!framing.checkNow(stream)) throw new Error('정면 구도가 바뀌었어요. 화면에서 전신이 보이는지 다시 확인해 주세요.');
    };
    checkFront();
    setStarting(true);
    let current: Capture | undefined;
    try {
      const previous = cancelled.current;
      if (previous) {
        if (!socket.send({ type: 'recording_cancel', recording_id: previous.id })) throw new Error('서브 기기와 다시 연결해 주세요.');
        if (!await closeCancelled(previous)) throw new Error('이전 촬영을 아직 정리하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      }
      const { recording_id } = await api.start(experienceId, AbortSignal.timeout(10000));
      cancelled.current = null;
      let media: ReturnType<typeof record>;
      try {
        checkFront();
        media = record(stream);
      }
      catch (err) { queueCancel(recording_id); throw err; }
      current = { id: recording_id, media, side: new SideRecording(recording_id), abort: new AbortController(), frontUploaded: false };
      capture.current = current;
      setCanCancelStart(true);
      const startedCapture = current;
      void media.result.catch((err: Error) => {
        if (capture.current === startedCapture) discardCapture(err.message);
      });
      if (!socket.send({ type: 'recording_start', recording_id })) throw new Error('서브 기기와의 연결이 끊겨 촬영하지 못했어요.');
      const { signal } = current.abort;
      await Promise.all([media.started, current.side.waitFor('start', signal)]);
      signal.throwIfAborted();
      setRecordingStart(Date.now());
      setElapsed(0);
      setScreen('record');
    } catch (err) {
      if (!current) throw err;
      if (capture.current === current) discardCapture(err instanceof Error ? err.message : '촬영을 시작하지 못했어요.');
    } finally {
      setStarting(false);
      setCanCancelStart(false);
    }
  }

  async function finishRecording() {
    const current = capture.current;
    if (!current) return;
    setScreen('finishing');
    const { signal } = current.abort;
    const videoBlob = current.media.stop();
    if (current.side.retryUpload()) {
      if (!socket.send({ type: 'recording_stop', recording_id: current.id })) throw new Error('기기 연결이 복구되면 촬영 종료를 다시 눌러 주세요.');
    }
    try {
      const blob = await videoBlob;
      signal.throwIfAborted();
      if (!current.frontUploaded) {
        await api.video(current.id, blob, 'front', AbortSignal.any([signal, AbortSignal.timeout(30000)]));
        current.frontUploaded = true;
      }
      await current.side.waitFor('upload', signal);
      await api.stop(current.id, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
      signal.throwIfAborted();
    } catch (err) {
      signal.throwIfAborted();
      throw err;
    }
    camera.close();
    walkTask.current = createAnalysisTask({
      start: (signal) => api.analyseWalking(current.id, { signal }),
      status: (id, signal) => api.walkingStatus(id, { signal }),
      result: (id, signal) => api.walkingResult(id, { signal }),
    });
    void walkTask.current.run().catch(() => undefined);
    setScreen('recorded');
  }

  function leaveAnalysis() {
    photoAbort.current?.abort();
    walkTask.current?.cancel();
    fashionTask.current?.cancel();
    camera.close();
    action.setError('');
    setScreen('recorded');
  }

  async function showWalking() {
    if (!walkTask.current) throw new Error('워킹 영상이 없어요.');
    setScreen('walking');
    setWalkingResult(await walkTask.current.run());
    setFashionResult(undefined);
    setScreen('result');
  }

  async function prepareFashion() {
    const choices = await api.styles();
    setStyles(choices);
    setScreen('style');
  }

  async function shootOutfit() {
    const selectedStyle = styles.find((style) => String(style.id) === styleId);
    if (experienceId === undefined || !selectedStyle) return;
    photoAbort.current = new AbortController();
    const { signal } = photoAbort.current;
    setQualityRejected(false);
    for (let remaining = 3; remaining > 0; remaining--) {
      setCountdown(remaining);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      signal.throwIfAborted();
    }
    const photo = await takePhoto(video.current);
    signal.throwIfAborted();
    setCountdown(undefined);
    setScreen('checking');
    let imageId: Id;
    try {
      const { image_id } = await api.image(experienceId, photo, { signal });
      const check = await api.quality(image_id, { signal });
      if (!check.passed) {
        setQualityRejected(true);
        throw new Error(check.message || '머리와 발이 모두 보이도록 전신을 다시 찍어 주세요.');
      }
      imageId = image_id;
    } catch (err) {
      if (!signal.aborted) setScreen('photo');
      throw err;
    }
    signal.throwIfAborted();
    camera.close();
    fashionTask.current = createAnalysisTask({
      start: (signal) => api.analyseFashion(experienceId, imageId, selectedStyle.id, { signal }),
      status: (id, signal) => api.fashionStatus(id, { signal }),
      result: (id, signal) => api.fashionResult(id, { signal }),
    });
    await showCombined();
  }

  async function showCombined() {
    if (!walkTask.current || !fashionTask.current) throw new Error('분석할 촬영 결과가 없어요.');
    setScreen('fashion');
    const [walk, fashion] = await Promise.all([walkTask.current.run(), fashionTask.current.run()]);
    setWalkingResult(walk);
    setFashionResult(fashion);
    setScreen('result');
  }

  async function saveAndEnd() {
    if (experienceId === undefined) return;
    if (!saved) {
      await api.save(experienceId);
      setSaved(true);
    }
    await api.end(experienceId);
    camera.close();
    setScreen('saved');
  }

  if (screen === 'login') return <Layout role={mainRole} step={0} phase="로그인" title="Google 계정으로 시작해요"
    subtitle="로그인이 끝나면 이 기기에서 체험을 시작하고 연결 코드를 발급해요."
    panel="메인 기기 로그인" tone="pink" art="devices" tag="메인 기기 · 계정 확인">
    <Detail><strong>Google 계정</strong><small>체험 결과를 저장하려면 Google 계정으로 시작해요.</small></Detail>
    <Buttons>
      {!action.busy && <Link href={api.login} onClick={onLogin}>Google로 계속하기</Link>}
      <Button data-secondary disabled={action.busy} onClick={onBack}>역할 다시 선택</Button>
    </Buttons>
    {action.busy && <p role="status">로그인 상태를 확인하고 있어요…</p>}{error()}
  </Layout>;

  if (screen === 'pair') return <Layout role={mainRole} step={0} phase="기기 연결" title={copied ? '연결 코드를 복사했어요' : '다른 기기를 연결해 주세요'}
    subtitle="서브 기기에서 Walkers 첫 화면을 열고 아래 코드를 입력해 주세요."
    panel="연결 코드" tone="sage" art="devices" tag="메인 화면 · 기기 연결">
    <Code aria-label={`연결 코드 ${experience?.pairing_code}`} aria-live="polite">
      {Array.from(experience?.pairing_code ?? '', (char, index) => <span key={index}>{char}</span>)}
    </Code>
    <Detail>
      <strong>{devices.some((device) => device.camera_view === 'side' && device.status !== 'disconnected') || peerReady ? '서브 기기가 연결됐어요' : '서브 기기 연결 대기 중'}</strong>
      <small>두 기기로 정면과 측면 영상을 촬영해요.</small>
    </Detail>
    <Buttons>
      <Button onClick={() => void action.run(async () => {
        if (!navigator.clipboard || !experience) throw new Error('코드를 직접 입력해 주세요.');
        await navigator.clipboard.writeText(experience.pairing_code);
        setCopied(true);
      })}>코드 복사</Button>
      <Button data-secondary onClick={() => { action.setError(''); setScreen('camera'); }}>카메라 설정</Button>
    </Buttons>
    <Buttons><Button data-secondary disabled={action.busy} onClick={() => void action.run(async () => {
      if (experienceId !== undefined) await api.end(experienceId);
      onBack();
    })}>역할 다시 선택</Button></Buttons>
    {linkError}{error()}
  </Layout>;

  if (screen === 'camera') return <Layout role={mainRole} step={1} phase="카메라 설정"
    title={starting ? '두 기기의 녹화 시작을 확인하고 있어요' : !camera.stream ? '정면 카메라를 켜 주세요' : framing.confirmed && peerReady ? '촬영할 준비가 됐어요' : '머리와 발이 모두 보이게 서 주세요'}
    subtitle="두 기기에서 전신이 잘 보이는 위치를 확인하고 촬영을 시작해요."
    panel={camera.stream ? '촬영 준비 상태' : '카메라 권한'} tone={framing.confirmed && peerReady ? 'sage' : 'stone'}
    art="standing" tag="메인 카메라 · 정면" stage={preview}>
    <Detail><strong>정면 카메라</strong><small>{camera.stream ? '사용 중' : '카메라 접근 권한을 허용해 주세요.'}</small></Detail>
    <Detail><strong>측면 카메라</strong><small>{peerReady ? '준비 완료' : '서브 기기에서 카메라를 켜고 구도를 확인해 주세요.'}</small></Detail>
    {camera.stream && !starting && <FramingGuide view="front" {...framing} />}
    {camera.stream && <Detail><label><input type="checkbox" checked={framing.confirmed} disabled={starting || !framing.canConfirm} onChange={(event) => framing.confirm(event.target.checked)} /> 정면 화면에서 머리와 발이 모두 보여요.</label></Detail>}
    <Buttons>
      {camera.stream
        ? <Button disabled={!framing.confirmed || !peerReady || !socketReady || action.busy} onClick={() => void action.run(startRecording)}>워킹 촬영 시작</Button>
        : <Button disabled={action.busy} onClick={() => void action.run(async () => { await camera.open(); })}>카메라 권한 요청</Button>}
      {starting && canCancelStart && <Button data-secondary onClick={() => discardCapture('촬영을 취소했어요. 구도를 확인하고 다시 시작해 주세요.')}>촬영 취소</Button>}
      {!starting && <Button data-secondary disabled={action.busy} onClick={() => {
        socket.send({ type: 'camera_closed', camera_view: 'front' });
        camera.close();
        action.setError('');
        setScreen('pair');
      }}>연결 코드 보기</Button>}
    </Buttons>
    {linkError}{error()}
  </Layout>;

  if (screen === 'record') return <Layout role={mainRole} step={2} phase="워킹 촬영" title="워킹을 촬영하고 있어요"
    subtitle="평소처럼 걸어 주세요. 촬영을 마쳤다면 종료 버튼을 눌러 주세요."
    panel="녹화 상태" tone="sage" art="walking" tag={`녹화 · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`} stage={preview}>
    <Detail><strong>정면 영상</strong><small>메인 기기에서 촬영하고 있어요.</small></Detail>
    <Detail><strong>측면 영상</strong><small>서브 기기에서 함께 촬영해요.</small></Detail>
    <Buttons>
      <Button disabled={action.busy} onClick={() => void action.run(finishRecording)}>워킹 촬영 종료</Button>
      <Button data-secondary disabled={action.busy} onClick={() => discardCapture('촬영을 취소했어요. 구도를 확인하고 다시 시작해 주세요.')}>촬영 취소</Button>
    </Buttons>
    {linkError}{error()}
  </Layout>;

  if (screen === 'finishing') return <Layout role={mainRole} step={2} phase="영상 전송" title="정면·측면 영상을 확인하고 있어요"
    subtitle="두 영상이 모두 전송되면 워킹 분석을 시작해요." panel="전송 상태" tone="sage" art="motion" tag="워킹 촬영 · 영상 전송">
    {action.busy && <p role="status">영상 파일을 확인하고 전송하고 있어요…</p>}
    <Buttons>
      {action.error && <Button disabled={action.busy} onClick={() => void action.run(finishRecording)}>영상 전송 다시 시도</Button>}
      <Button data-secondary onClick={() => discardCapture('이전 영상을 사용하지 않아요. 구도를 확인하고 다시 촬영해 주세요.')}>다시 촬영</Button>
    </Buttons>
    {linkError}{error()}
  </Layout>;

  if (screen === 'recorded') return <Layout role={mainRole} step={3} phase="촬영 완료" title="워킹 촬영을 마쳤어요"
    subtitle="워킹 분석을 백그라운드에서 요청했어요. 걸음걸이만 확인하거나 착장을 촬영해 패션 결과도 볼 수 있어요."
    panel="무엇을 확인할까요?" tone="pink" art="motion" tag="워킹 촬영 · 종료">
    <Detail><strong>워킹 결과만 보기</strong><small>걸음걸이에 대한 지표와 개선 피드백을 확인해요.</small></Detail>
    <Detail><strong>패션 추가 분석</strong><small>착장을 촬영하고 선호 스타일과 비교해요.</small></Detail>
    <Buttons><Button disabled={action.busy} onClick={() => void action.run(showWalking)}>워킹 결과만 보기</Button>
      {fashionTask.current
        ? <Button data-secondary disabled={action.busy} onClick={() => void action.run(showCombined)}>통합 결과 보기</Button>
        : <Button data-secondary disabled={action.busy} onClick={() => void action.run(prepareFashion)}>패션 추가 분석</Button>}
    </Buttons>
    <Buttons><Button data-secondary disabled={action.busy} onClick={() => void action.run(async () => {
      if (experienceId !== undefined) await api.end(experienceId);
      onBack();
    })}>결과 없이 체험 종료</Button></Buttons>
    {error()}
  </Layout>;

  if (screen === 'walking') return <Layout role={mainRole} step={3} phase="워킹 분석"
    title={action.error ? '워킹 분석을 마치지 못했어요' : '걸음의 움직임을 분석하고 있어요'}
    subtitle="정면과 측면 영상을 바탕으로 걸음걸이와 자세를 분석해요."
    panel={action.error ? '다음 단계' : '분석 진행 상태'} tone={action.error ? 'stone' : 'sage'} art="motion" tag="워킹 분석">
    {action.busy && <p role="status">영상의 움직임과 관절 위치를 확인하고 있어요…</p>}
    <Buttons>
      {action.error && <Button disabled={action.busy} onClick={() => void action.run(showWalking)}>워킹 분석 재시도</Button>}
      <Button data-secondary onClick={leaveAnalysis}>분석 화면에서 나가기</Button>
    </Buttons>
    {error()}
  </Layout>;

  if (screen === 'style') return <Layout role={mainRole} step={3} phase="패션 준비" title="어떤 스타일을 선호하세요?"
    subtitle="평소 선호하는 스타일을 선택하고 현재 착장과 비교해 보세요." panel="스타일 취향" tone="pink" art="outfit" tag="패션 분석 · 스타일 선택">
    <label htmlFor="style">선호 스타일</label>
    <Select id="style" value={styleId} onChange={(event) => setStyleId(event.target.value)}>
      <option value="">스타일을 선택해 주세요</option>
      {styles.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
    </Select>
    {!styles.length && <Notice role="status">선택할 수 있는 스타일이 없어요.</Notice>}
    <Buttons><Button disabled={!styleId} onClick={() => { action.setError(''); setScreen('photo'); }}>촬영 안내 보기</Button>
      <Button data-secondary onClick={() => { action.setError(''); setScreen('recorded'); }}>이전으로</Button></Buttons>
  </Layout>;

  if (screen === 'photo') return <Layout role={mainRole} step={3} phase="착장 촬영"
    title={countdown ? '자세를 유지해 주세요' : qualityRejected ? '착장을 다시 찍어야 해요' : '현재 착장을 따로 촬영해요'}
    subtitle="머리부터 신발까지 화면에 나오도록 카메라에서 조금 떨어져 서 주세요."
    panel={countdown ? '자동 촬영' : '촬영 전 확인'} tone={qualityRejected ? 'stone' : 'pink'} art="outfit"
    tag={countdown ? `촬영까지 ${countdown}초` : '정면 카메라 · 착장'} stage={preview}>
    <Detail><strong>{countdown ? '곧 촬영해요' : '전신이 보이나요?'}</strong><small>전신이 한 화면에 들어오도록 위치를 조정해 주세요.</small></Detail>
    <Buttons>{countdown
      ? <Button data-secondary onClick={() => { photoAbort.current?.abort(); setCountdown(undefined); }}>촬영 취소</Button>
      : <>
        <Button disabled={action.busy} onClick={() => void action.run(async () => {
          if (camera.stream) {
            try { await shootOutfit(); } finally { setCountdown(undefined); }
          } else await camera.open();
        })}>{!camera.stream ? '카메라 켜기' : qualityRejected ? '착장 사진 다시 찍기' : '착장 사진 촬영'}</Button>
        <Button data-secondary disabled={action.busy} onClick={() => { camera.close(); setQualityRejected(false); action.setError(''); setScreen('style'); }}>스타일 다시 선택</Button>
      </>}</Buttons>
    {error()}
  </Layout>;

  if (screen === 'checking' || screen === 'fashion') return <Layout role={mainRole} step={3} phase={screen === 'checking' ? '사진 확인' : '통합 분석'}
    title={screen === 'checking' ? '촬영한 사진을 확인하고 있어요' : action.error ? '분석을 완료하지 못했어요' : 'AI가 촬영 결과를 정리하고 있어요'}
    subtitle="촬영이 끝나면 워킹과 패션 피드백을 함께 확인할 수 있어요."
    panel={screen === 'checking' ? '이미지 확인' : '워킹 · 패션 종합 피드백'} tone={action.error ? 'stone' : 'pink'} art="outfit" tag="패션 분석">
    {action.busy && <p role="status">{screen === 'checking' ? '전신이 잘 보이는지 확인하고 있어요…' : '촬영 결과를 분석하고 있어요…'}</p>}
    <Buttons>
      {action.error && screen === 'fashion' && <>
        <Button disabled={action.busy} onClick={() => void action.run(showCombined)}>통합 분석 다시 시도</Button>
        <Button data-secondary disabled={action.busy} onClick={() => void action.run(async () => {
          fashionTask.current?.cancel();
          await showWalking();
        })}>워킹 결과만 보기</Button>
      </>}
      <Button data-secondary onClick={leaveAnalysis}>분석 화면에서 나가기</Button>
    </Buttons>
    {error()}
  </Layout>;

  if (screen === 'result' && walkingResult && walkTask.current?.id !== undefined) {
    return <Results walking={walkingResult} fashion={fashionResult} analysisId={walkTask.current.id}
      busy={action.busy} error={action.error} onBack={leaveAnalysis} onSave={() => void action.run(saveAndEnd)} />;
  }

  return <Layout role={mainRole} step={3} phase="체험 종료" title="결과를 저장했어요"
    subtitle="이번 체험을 마쳤어요. 두 기기의 촬영과 연결을 종료했어요." panel="체험 완료"
    tone="pink" art="devices" tag="결과 저장 · 기기 연결 해제">
    <Detail><strong>저장 완료</strong><small>체험 결과가 저장됐어요.</small></Detail>
    <Buttons><Button onClick={onBack}>처음으로</Button><Button data-secondary disabled={action.busy} onClick={() => void action.run(async () => { await api.logout(); onBack(); })}>로그아웃</Button></Buttons>
    {error()}
  </Layout>;
}
