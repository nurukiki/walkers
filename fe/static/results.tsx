import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Feedback, Id, Metric, Timeline, View } from './api.ts';
import { Button, Buttons, Detail, Layout, Metrics, MetricTile, Notice } from './layout.tsx';

const timestamp = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function closestFrame(frames: Timeline['frames'], time: number) {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (frames[mid].time_ms < time) low = mid + 1;
    else high = mid;
  }
  const before = frames[low - 1], after = frames[low];
  return !after || (before && time - before.time_ms < after.time_ms - time) ? before : after;
}

export function Results({ walking, fashion, analysisId, busy, error, onBack, onSave }: {
  walking: Feedback;
  fashion?: Feedback;
  analysisId: Id;
  busy: boolean;
  error: string;
  onBack: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState<'walking' | 'fashion'>('walking');
  const [camera, setCamera] = useState<View>('front');
  const [selected, setSelected] = useState(0);
  const [url, setUrl] = useState('');
  const [videoError, setVideoError] = useState('');
  const [replayAttempt, setReplayAttempt] = useState(0);
  const [overlay, setOverlay] = useState<Timeline>();
  const [position, setPosition] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = tab === 'walking' ? walking : fashion;
  const metric = data?.metrics?.[selected];

  useEffect(() => {
    if (tab !== 'walking') return;
    const controller = new AbortController();
    const { signal } = controller;
    void api.replay(analysisId, camera, { signal }).then(({ url }) => { if (!signal.aborted) setUrl(url); }).catch(() => {
      if (!signal.aborted) setVideoError('영상을 불러오지 못했어요. 다시 시도하거나 다른 시점을 선택해 주세요.');
    });
    void api.timeline(analysisId, camera, undefined, undefined, { signal }).then((data) => {
      if (!signal.aborted) setOverlay({ ...data, frames: [...data.frames].sort((a, b) => a.time_ms - b.time_ms) });
    }).catch(() => { if (!signal.aborted) setOverlay(undefined); });
    return () => controller.abort();
  }, [analysisId, camera, replayAttempt, tab]);

  useEffect(() => {
    const el = video.current;
    const layer = canvas.current;
    const ctx = layer?.getContext('2d');
    if (!el || !layer || !ctx || !overlay?.frames.length) return;
    let token = 0;
    const draw = () => {
      const w = layer.clientWidth, h = layer.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      if (layer.width !== Math.round(w * ratio) || layer.height !== Math.round(h * ratio)) {
        layer.width = Math.round(w * ratio);
        layer.height = Math.round(h * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const frame = closestFrame(overlay.frames, el.currentTime * 1000);
      if (frame && Math.abs(frame.time_ms - el.currentTime * 1000) <= 250 && el.videoWidth && el.videoHeight) {
        const scale = Math.min(w / el.videoWidth, h / el.videoHeight);
        const vw = el.videoWidth * scale, vh = el.videoHeight * scale;
        const toX = (x: number) => (w - vw) / 2 + x * vw;
        const toY = (y: number) => (h - vh) / 2 + y * vh;
        ctx.strokeStyle = '#fda8ae';
        ctx.lineWidth = 2.5;
        for (const [from, to] of overlay.connections ?? []) {
          const a = frame.joints[from], b = frame.joints[to];
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(toX(a.x), toY(a.y));
          ctx.lineTo(toX(b.x), toY(b.y));
          ctx.stroke();
        }
        ctx.fillStyle = '#fbd7bc';
        for (const point of Object.values(frame.joints)) {
          ctx.beginPath();
          ctx.arc(toX(point.x), toY(point.y), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      token = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(token);
  }, [tab, url, overlay]);

  function changeView(view: View) {
    if (view === camera) return;
    setUrl('');
    setOverlay(undefined);
    setPosition(0);
    setVideoError('');
    setCamera(view);
  }

  function seek(item: Metric) {
    if (video.current && item.start_ms !== undefined) video.current.currentTime = item.start_ms / 1000;
  }

  return <Layout role="메인 · 정면" step={3} phase={fashion ? '통합 결과' : '워킹 결과'}
    title={tab === 'walking' ? '걸음의 변화를 확인하세요' : '선호 스타일과 착장을 비교해요'}
    subtitle={tab === 'walking' ? '촬영한 영상과 항목별 피드백을 함께 확인해 보세요.' : '촬영한 착장과 선택한 스타일을 비교한 결과예요.'}
    panel={tab === 'walking' ? '워킹 피드백' : '패션 피드백'} tone={tab === 'walking' ? 'sage' : 'pink'}
    art={tab === 'walking' ? 'motion' : 'outfit'} tag={tab === 'walking' ? `워킹 영상 · ${timestamp(position)}` : '패션 피드백'}
    stage={tab === 'walking' && url ? <>
      <video ref={video} src={url} aria-label="워킹 분석 영상" playsInline controls
        onError={() => { setUrl(''); setVideoError('분석 영상을 재생하지 못했어요.'); }}
        onTimeUpdate={(event) => setPosition(Math.floor(event.currentTarget.currentTime * 1000))} />
      <canvas ref={canvas} aria-hidden="true" />
    </> : undefined}
    beneath={tab === 'walking' ? <>
      <Buttons aria-label="영상 시점">
        <Button data-secondary aria-pressed={camera === 'front'} onClick={() => changeView('front')}>정면 영상</Button>
        <Button data-secondary aria-pressed={camera === 'side'} onClick={() => changeView('side')}>측면 영상</Button>
        {metric?.start_ms !== undefined && url && <Button data-secondary onClick={() => seek(metric)}>{timestamp(metric.start_ms)} 구간 보기</Button>}
      </Buttons>
      {videoError && <>
        <Notice role="status">{videoError}</Notice>
        <Buttons><Button data-secondary onClick={() => {
          setVideoError('');
          setReplayAttempt((attempt) => attempt + 1);
        }}>영상 다시 불러오기</Button></Buttons>
      </>}
    </> : undefined}>
    {fashion && <Buttons aria-label="결과 종류" style={{ margin: '0 0 16px' }}>
      <Button data-secondary aria-pressed={tab === 'walking'} onClick={() => { setTab('walking'); setSelected(0); setPosition(0); }}>워킹 결과</Button>
      <Button data-secondary aria-pressed={tab === 'fashion'} onClick={() => { setTab('fashion'); setSelected(0); }}>패션 결과</Button>
    </Buttons>}
    {data?.summary && <p>{data.summary}</p>}
    {data?.metrics && <Metrics>{data.metrics.map((item, index) =>
      <MetricTile key={`${item.label}-${index}`} aria-pressed={selected === index} onClick={() => { setSelected(index); seek(item); }}>
        <small>{item.label}</small>
        {item.value !== undefined && <strong>{item.value}</strong>}
        {item.feedback && <span>{item.feedback}</span>}
      </MetricTile>)}</Metrics>}
    {!!data?.recommendations?.length && <Detail style={{ marginTop: 16 }}>
      <strong>개선 제안</strong><ul>{data.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </Detail>}
    {!data?.summary && !data?.metrics?.length && !data?.recommendations?.length && <p>표시할 피드백이 없어요.</p>}
    <Buttons>
      <Button onClick={onSave} disabled={busy}>{busy ? '저장 중…' : '결과 저장 및 종료'}</Button>
      <Button data-secondary onClick={onBack} disabled={busy}>결과 선택으로 돌아가기</Button>
    </Buttons>
    {error && <Notice role="alert">{error}</Notice>}
  </Layout>;
}
