import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { View } from './api.ts';
import { canConfirmFraming, framingAdvice, judgeFraming } from './framing.ts';
import type { Framing } from './framing.ts';
import { Button, Buttons, Detail } from './layout.tsx';

const wasmPath = import.meta.env.VITE_WALKERS_POSE_WASM_URL ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const modelPath = import.meta.env.VITE_WALKERS_POSE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface Reading {
  stream: MediaStream;
  status: Framing;
  previewReady: boolean;
  confirmed: boolean;
}

export function useFraming(video: RefObject<HTMLVideoElement | null>, view: View, stream: MediaStream | null) {
  const [reading, setReading] = useState<Reading>();
  const latest = useRef<Reading>(undefined);
  const verify = useRef<((expected: MediaStream) => boolean) | null>(null);
  const [attempt, setAttempt] = useState(0);

  function publish(next: Reading) {
    const previous = latest.current;
    if (previous?.stream === next.stream && previous.status === next.status &&
      previous.previewReady === next.previewReady && previous.confirmed === next.confirmed) return;
    latest.current = next;
    setReading(next);
  }

  useEffect(() => {
    if (!stream) {
      latest.current = undefined;
      setReading(undefined);
      return;
    }
    let active = true;
    let model: PoseLandmarker | undefined = undefined;
    let consecutive = 0;
    let status: Framing = 'loading';
    const input = stream;
    const previewIsLive = (preview: HTMLVideoElement | null): preview is HTMLVideoElement =>
      !!preview && preview.srcObject === input && preview.readyState >= 2 && !preview.paused &&
      preview.videoWidth > 0 && preview.videoHeight > 0 &&
      input.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled && !track.muted);
    const report = (next: Framing, previewReady: boolean) => {
      status = next;
      const previous = latest.current;
      publish({
        stream: input, status, previewReady,
        confirmed: previous?.stream === input && previous.status === next && previous.confirmed &&
          canConfirmFraming(next, previewReady),
      });
    };
    report('loading', false);
    const deadline = setTimeout(() => {
      report('unavailable', previewIsLive(video.current));
    }, 20000);
    const canLoadModel = () => active && latest.current?.status === 'loading';
    function sample() {
      const preview = video.current;
      const previewReady = previewIsLive(preview);
      if (status === 'unavailable' || !model) {
        report(status, previewReady);
        return;
      }
      let next: Framing = 'not-visible';
      try {
        if (previewReady) next = judgeFraming(model.detect(preview).landmarks, view);
      } catch { next = 'unavailable'; }
      consecutive = next === 'ready' ? consecutive + 1 : 0;
      if (next !== 'ready' || consecutive >= 2) report(next, previewReady);
    }
    const timer = setInterval(sample, 400);
    verify.current = (expected) => {
      if (expected !== input || !latest.current?.confirmed) return false;
      sample();
      return latest.current.confirmed;
    };
    void (async () => {
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(wasmPath);
      if (!canLoadModel()) return;
      const loaded = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
      if (!canLoadModel()) { loaded.close(); return; }
      clearTimeout(deadline);
      model = loaded;
    })().catch(() => {
      clearTimeout(deadline);
      if (active) report('unavailable', previewIsLive(video.current));
    });
    return () => {
      active = false;
      verify.current = null;
      clearTimeout(deadline);
      clearInterval(timer);
      model?.close();
    };
  }, [stream, view, video, attempt]);

  const visible = stream && reading?.stream === stream ? reading : undefined;
  return {
    status: visible?.status ?? 'loading' as const,
    canConfirm: !!visible && canConfirmFraming(visible.status, visible.previewReady),
    confirmed: !!visible?.confirmed,
    confirm: (checked: boolean) => {
      const current = latest.current;
      if (current) publish({ ...current, confirmed: checked && current.stream === stream &&
        canConfirmFraming(current.status, current.previewReady) });
    },
    checkNow: (expected: MediaStream) => verify.current?.(expected) ?? false,
    retry: () => {
      const current = latest.current;
      if (current) publish({ ...current, status: 'loading', confirmed: false });
      setAttempt((value) => value + 1);
    },
  };
}

export function FramingGuide({ view, status, retry }: { view: View; status: Framing; retry: () => void }) {
  const [voice, setVoice] = useState(false);
  const message = framingAdvice(status, view);
  const speech = globalThis.speechSynthesis;

  function speak() {
    if (!speech || !globalThis.SpeechSynthesisUtterance) return;
    const announcement = new SpeechSynthesisUtterance(message);
    announcement.lang = 'ko-KR';
    speech.cancel();
    speech.speak(announcement);
  }

  useEffect(() => {
    if (!voice || status === 'loading') return;
    const timer = setTimeout(speak, 700);
    return () => { clearTimeout(timer); speech?.cancel(); };
  }, [voice, message, status, speech]);

  return <>
    <Detail role="status"><strong>카메라 구도 확인</strong><small>{message}</small></Detail>
    <Buttons>
      {speech && globalThis.SpeechSynthesisUtterance && <Button type="button" data-secondary aria-pressed={voice} onClick={() => {
        if (voice) { speech.cancel(); setVoice(false); }
        else { speak(); setVoice(true); }
      }}>{voice ? '음성 안내 끄기' : '음성 안내 켜기'}</Button>}
      {status === 'unavailable' && <Button type="button" data-secondary onClick={retry}>구도 확인 다시 시도</Button>}
    </Buttons>
  </>;
}
