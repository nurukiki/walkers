import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import type { DeviceEvent, Id, Pairing } from './api.ts';
import { useCamera } from './camera.ts';
import { FramingGuide, useFraming } from './camera-setup.tsx';
import { record } from './recording.ts';
import { Button, Buttons, Detail, Layout, LivePreview, Notice } from './layout.tsx';
import { useAction, useDeviceSocket } from './session.ts';

const role = '서브 · 측면';
type State = 'camera' | 'starting' | 'recording' | 'uploading' | 'uploaded' | 'disconnected';
interface Capture {
  id: Id;
  media: ReturnType<typeof record>;
  abort: AbortController;
  status: 'starting' | 'recording' | 'uploading' | 'upload-failed' | 'uploaded';
}

export function SideDevice({ pairing, onBack }: { pairing: Pairing; onBack: () => void }) {
  const [state, setState] = useState<State>('camera');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const camera = useCamera('side');
  const action = useAction();
  const video = useRef<HTMLVideoElement>(null);
  const framing = useFraming(video, 'side', state === 'camera' ? camera.stream : null);
  const capture = useRef<Capture>(null);
  const failedId = useRef<Id>(undefined);
  const disconnected = useRef(false);
  const socket = useDeviceSocket(state === 'disconnected' ? undefined : pairing.experience_id, onMessage);
  const { send } = socket;
  const open = socket.state === 'open';
  const ready = framing.confirmed;

  useEffect(() => clearCapture, []);

  useEffect(() => {
    if (open) reportStatus();
  }, [state, open, ready, send]);

  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 300);
    return () => clearInterval(timer);
  }, [startedAt, state]);

  function clearCapture() {
    const current = capture.current;
    capture.current = null;
    current?.abort.abort();
    current?.media.cancel();
  }

  function endLocal() {
    disconnected.current = true;
    failedId.current = undefined;
    clearCapture();
    camera.close();
    setState('disconnected');
  }

  function reportStatus() {
    const current = capture.current;
    if (failedId.current !== undefined) send({ type: 'recording_failed', recording_id: failedId.current, camera_view: 'side' });
    if (!current) send({ type: ready ? 'camera_ready' : 'camera_closed', camera_view: 'side' });
    else if (current.status === 'recording') send({ type: 'recording_started', recording_id: current.id, camera_view: 'side' });
    else if (current.status === 'uploaded') send({ type: 'video_uploaded', recording_id: current.id, camera_view: 'side' });
    else if (current.status === 'upload-failed') send({ type: 'video_upload_failed', recording_id: current.id, camera_view: 'side' });
  }

  function onMessage(event: DeviceEvent) {
    if (event.type === 'experience_ended' || (event.type === 'device_disconnected' && event.camera_view === 'side')) {
      endLocal();
      return;
    }
    if (disconnected.current) return;
    if (event.type === 'camera_status_request') reportStatus();
    if (event.type === 'recording_cancel') {
      if (failedId.current === event.recording_id) failedId.current = undefined;
      if (capture.current?.id === event.recording_id) {
        clearCapture();
        framing.confirm(false);
        send({ type: 'camera_closed', camera_view: 'side' });
        action.setError('메인 기기에서 촬영을 취소했어요. 구도를 맞춘 뒤 다시 준비해 주세요.');
        setState('camera');
      } else reportStatus();
    }
    if (event.type === 'recording_start') {
      if (capture.current?.id === event.recording_id) reportStatus();
      else if (camera.stream && state === 'camera' && !capture.current && framing.checkNow(camera.stream)) {
        void startSide(event.recording_id, camera.stream);
      }
      else send({ type: 'recording_failed', recording_id: event.recording_id, camera_view: 'side' });
    }
    if (event.type === 'recording_stop') {
      const current = capture.current;
      if (current?.id === event.recording_id) {
        void uploadSide();
      } else {
        send({ type: 'recording_failed', recording_id: event.recording_id, camera_view: 'side' });
      }
    }
  }

  function failRecording(id: Id, reason: unknown) {
    clearCapture();
    failedId.current = id;
    framing.confirm(false);
    setState('camera');
    action.setError(reason instanceof Error ? reason.message : '측면 영상 녹화에 실패했어요. 다시 촬영해 주세요.');
    send({ type: 'recording_failed', recording_id: id, camera_view: 'side' });
    send({ type: 'camera_closed', camera_view: 'side' });
  }

  async function startSide(id: Id, stream: MediaStream) {
    action.setError('');
    failedId.current = undefined;
    let current: Capture | undefined;
    try {
      const media = record(stream);
      current = { id, media, abort: new AbortController(), status: 'starting' };
      capture.current = current;
      setState('starting');
      const startedCapture = current;
      void media.result.catch((err: unknown) => {
        if (capture.current === startedCapture) failRecording(id, err);
      });
      await media.started;
      if (capture.current !== current) return;
      current.status = 'recording';
      send({ type: 'recording_started', recording_id: id, camera_view: 'side' });
      setStartedAt(Date.now());
      setElapsed(0);
      setState('recording');
    } catch (err) {
      if (!current || capture.current === current) failRecording(id, err);
    }
  }

  async function uploadSide() {
    const current = capture.current;
    if (!current || current.status === 'starting' || current.status === 'uploading') return;
    if (current.status === 'uploaded') { reportStatus(); return; }
    current.status = 'uploading';
    action.setError('');
    setState('uploading');
    let blob: Blob;
    try {
      blob = await current.media.stop();
    } catch (err) {
      if (capture.current === current) failRecording(current.id, err);
      return;
    }
    if (capture.current !== current) return;
    try {
      await api.video(current.id, blob, 'side', AbortSignal.any([current.abort.signal, AbortSignal.timeout(30000)]));
      if (capture.current !== current) return;
      current.status = 'uploaded';
      send({ type: 'video_uploaded', recording_id: current.id, camera_view: 'side' });
      camera.close();
      setState('uploaded');
    } catch (err) {
      if (capture.current !== current) return;
      current.status = 'upload-failed';
      send({ type: 'video_upload_failed', recording_id: current.id, camera_view: 'side' });
      action.setError(err instanceof Error ? err.message : '측면 영상을 업로드하지 못했어요.');
    }
  }

  async function disconnect() {
    await api.disconnect(pairing.experience_id, pairing.device_id);
    endLocal();
  }

  const preview = camera.stream ? <LivePreview stream={camera.stream} videoRef={video} label="측면 카메라 미리보기" /> : undefined;
  const issue = action.error && <Notice role="alert">{action.error}</Notice>;
  const connection = !open ? <Notice role="status">메인 기기와 다시 연결하고 있어요…</Notice> : null;

  if (state === 'camera' || state === 'starting') return <Layout role={role} step={1} phase="카메라 설정"
    title={state === 'starting' ? '측면 녹화를 시작하고 있어요' : ready ? '메인 기기의 시작을 기다려요' : camera.stream ? '측면에서 전신이 보이게 서 주세요' : '측면 카메라를 켜 주세요'}
    subtitle="옆모습의 머리와 발이 모두 화면에 들어오도록 카메라 위치를 맞춰 주세요."
    panel={camera.stream ? '카메라 상태' : '측면 카메라 권한'} tone="sage"
    art="walking" tag="서브 카메라 · 측면" stage={preview}>
    {ready && <Detail><strong>측면 · 준비 완료</strong><small>메인 기기가 시작하면 함께 촬영해요.</small></Detail>}
    {camera.stream && state === 'camera' && <>
      <FramingGuide view="side" {...framing} />
      <Detail><label><input type="checkbox" checked={framing.confirmed} disabled={!framing.canConfirm} onChange={(event) => framing.confirm(event.target.checked)} /> 측면 화면에서 머리와 발이 모두 보여요.</label></Detail>
    </>}
    <Buttons>
      {state === 'camera' && !camera.stream && <Button disabled={action.busy} onClick={() => void action.run(async () => {
        await camera.open();
      })}>카메라 권한 요청</Button>}
      <Button data-secondary disabled={action.busy || state === 'starting'} onClick={() => void action.run(disconnect)}>기기 연결 해제</Button>
    </Buttons>
    {connection}{issue}
  </Layout>;

  if (state === 'recording' || state === 'uploading') return <Layout role={role} step={2} phase="워킹 촬영"
    title={state === 'recording' ? '옆모습을 촬영하고 있어요' : '측면 영상을 올리고 있어요'}
    subtitle="메인 기기의 시작과 종료 명령에 맞춰 옆모습을 촬영해요."
    panel="측면 영상" tone="sage" art="walking"
    tag={state === 'recording' ? `녹화 · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : '측면 영상 · 업로드'}
    stage={state === 'recording' ? preview : undefined}>
    <p role="status">{state === 'recording' ? '메인 기기에서 촬영을 종료할 때까지 기다려 주세요.' : '메인 기기에서 결과를 확인할 수 있도록 영상을 전송해요.'}</p>
    {state === 'uploading' && action.error && <Buttons><Button onClick={() => void uploadSide()}>다시 업로드</Button></Buttons>}
    {!open && <Buttons><Button data-secondary onClick={() => {
      if (capture.current) failRecording(capture.current.id, new Error('측면 촬영을 중단했어요. 두 기기가 다시 연결되면 재촬영할 수 있어요.'));
    }}>측면 촬영 중단</Button></Buttons>}
    {connection}{issue}
  </Layout>;

  if (state === 'uploaded') return <Layout role={role} step={3} phase="촬영 완료" title="측면 촬영을 마쳤어요"
    subtitle="메인 기기에서 체험을 이어서 진행해 주세요."
    panel="촬영 완료" tone="sage" art="devices" tag="측면 영상 전송 완료">
    <Detail><strong>메인 화면에서 계속</strong><small>기기 연결은 체험이 끝날 때까지 유지돼요.</small></Detail>
    {connection}
  </Layout>;

  return <Layout role={role} step={3} phase="체험 종료" title="기기 연결이 해제됐어요"
    subtitle="이 기기에서 카메라 사용을 종료했어요." panel="연결 종료" tone="stone" art="devices" tag="서브 기기 · 연결 종료">
    <Buttons><Button onClick={onBack}>처음으로</Button></Buttons>
  </Layout>;
}
