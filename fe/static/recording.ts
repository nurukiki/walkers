import type { DeviceEvent, Id } from './api.ts';

export class RecordingError extends Error {}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined); // Events can fail before the UI awaits them.
  return { promise, resolve, reject };
}

export function record(stream: MediaStream) {
  const tracks = stream.getVideoTracks().filter((track) => track.readyState === 'live');
  if (!tracks.length) throw new RecordingError('카메라 연결이 끊겼어요. 다시 켜 주세요.');
  if (!globalThis.MediaRecorder) throw new RecordingError('이 브라우저에서는 영상 녹화를 지원하지 않아요.');
  const format = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, format ? { mimeType: format } : undefined);
  const started = deferred<void>();
  const result = deferred<Blob>();
  const chunks: Blob[] = [];
  let stopping = false;
  let settled = false;
  let startTimer: ReturnType<typeof setTimeout>;
  let stopTimer: ReturnType<typeof setTimeout>;

  function cleanup() {
    settled = true;
    clearTimeout(startTimer);
    clearTimeout(stopTimer);
    for (const track of tracks) track.removeEventListener('ended', onTrackEnded);
  }
  function fail(error: Error) {
    if (settled) return;
    cleanup();
    started.reject(error);
    result.reject(error);
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* The browser already closed the recorder. */ }
    }
    chunks.length = 0;
  }
  function onTrackEnded() {
    if (!stopping) fail(new RecordingError('촬영 중 카메라가 끊겼어요. 다시 촬영해 주세요.'));
  }
  for (const track of tracks) track.addEventListener('ended', onTrackEnded);
  recorder.addEventListener('start', () => {
    if (!settled) {
      clearTimeout(startTimer);
      started.resolve();
    }
  }, { once: true });
  recorder.addEventListener('dataavailable', (event) => {
    if (!settled && event.data.size > 0) chunks.push(event.data);
  });
  recorder.addEventListener('stop', () => {
    if (settled) return;
    if (!stopping || !chunks.length) {
      fail(new RecordingError('정상적으로 녹화된 영상이 없어요. 다시 촬영해 주세요.'));
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0].type });
    cleanup();
    chunks.length = 0;
    result.resolve(blob);
  }, { once: true });
  recorder.addEventListener('error', () => fail(new RecordingError('영상을 녹화하지 못했어요. 다시 촬영해 주세요.')), { once: true });
  try { recorder.start(500); }
  catch {
    const error = new RecordingError('녹화를 시작하지 못했어요.');
    fail(error);
    throw error;
  }
  startTimer = setTimeout(() => fail(new RecordingError('녹화를 시작하지 못했어요.')), 6000);

  return {
    started: started.promise,
    result: result.promise,
    stop() {
      if (!settled && !stopping) {
        stopping = true;
        stopTimer = setTimeout(() => fail(new RecordingError('녹화 파일을 만들지 못했어요. 다시 촬영해 주세요.')), 8000);
        try { recorder.stop(); }
        catch { fail(new RecordingError('녹화를 종료하지 못했어요. 다시 촬영해 주세요.')); }
      }
      return result.promise;
    },
    cancel() { fail(new DOMException('촬영이 취소됐어요.', 'AbortError')); },
  };
}

export class SideRecording {
  readonly id: Id;
  private started = false;
  private uploaded = false;
  private uploadFailed = false;
  private failure?: RecordingError;

  constructor(id: Id) { this.id = id; }

  accept(event: DeviceEvent) {
    if (!('recording_id' in event && 'camera_view' in event) ||
      event.recording_id !== this.id || event.camera_view !== 'side') return;
    if (event.type === 'recording_started') this.started = true;
    if (event.type === 'recording_failed') this.failure = new RecordingError('측면 영상을 녹화하지 못했어요. 다시 촬영해 주세요.');
    if (event.type === 'video_uploaded') this.uploaded = true;
    if (event.type === 'video_upload_failed') this.uploadFailed = true;
    return this.failure;
  }

  retryUpload() {
    this.uploadFailed = false;
    return !this.uploaded;
  }

  get hasUpload() { return this.uploaded; }

  async waitFor(phase: 'start' | 'upload', signal: AbortSignal, timeoutMs = phase === 'start' ? 8000 : 30000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      signal.throwIfAborted();
      if (this.failure) throw this.failure;
      if (phase === 'start' ? this.started : this.uploaded) return;
      if (phase === 'upload' && this.uploadFailed) throw new Error('측면 영상을 전송하지 못했어요. 업로드를 다시 시도해 주세요.');
      if (Date.now() >= deadline) {
        if (phase === 'start') throw new RecordingError('서브 기기의 녹화 시작을 확인하지 못했어요.');
        throw new Error('측면 영상이 아직 도착하지 않았어요. 연결을 확인한 뒤 업로드를 재시도하거나 다시 촬영해 주세요.');
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(100, deadline - Date.now()))));
    }
  }
}
