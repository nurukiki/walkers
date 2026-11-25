export type View = 'front' | 'side';
export type Id = string | number;
type Status = 'pending' | 'queued' | 'processing' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelled';

export interface Experience {
  experience_id: Id;
  pairing_code: string;
  status?: string;
}

export interface Pairing {
  experience_id: Id;
  device_id: Id;
}

export interface Device {
  device_id: Id;
  camera_view: View;
  status: string;
}

export interface Analysis {
  analysis_id: Id;
  status: Status;
}

interface RequestDeadline {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Style {
  id: Id;
  name: string;
}

export interface Metric {
  label: string;
  value?: string | number;
  feedback?: string;
  start_ms?: number;
  end_ms?: number;
}

export interface Feedback {
  summary?: string;
  metrics?: Metric[];
  recommendations?: string[];
}

interface Point {
  x: number;
  y: number;
}

export interface Timeline {
  frames: { time_ms: number; joints: Record<string, Point> }[];
  connections?: [string, string][];
}

export type DeviceEvent =
  | { type: 'camera_ready' | 'camera_closed'; camera_view: View }
  | { type: 'camera_status_request' }
  | { type: 'recording_start' | 'recording_stop' | 'recording_cancel'; recording_id: Id }
  | { type: 'recording_started' | 'recording_failed' | 'video_uploaded' | 'video_upload_failed'; recording_id: Id; camera_view: 'side' }
  | { type: 'device_disconnected' | 'experience_ended'; camera_view?: View };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const id = (value: Id) => encodeURIComponent(value);
const experience = (value: Id) => `/experiences/${id(value)}`;
const recording = (value: Id) => `/recordings/${id(value)}`;
const walking = (value: Id) => `/walking-analyses/${id(value)}`;
const fashion = (value: Id) => `/fashion-analyses/${id(value)}`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, typeof body?.detail === 'string' ? body.detail : `요청을 처리하지 못했어요. (${res.status})`);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  try { return JSON.parse(text) as T; }
  catch { throw new Error('API 응답을 읽지 못했어요. 백엔드 연결을 확인해 주세요.'); }
}

function post<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function upload<T>(path: string, file: Blob, name: string, cameraView?: View, signal?: AbortSignal) {
  const data = new FormData();
  data.append('file', file, name);
  if (cameraView) data.append('camera_view', cameraView);
  return request<T>(path, { method: 'POST', body: data, signal });
}

function abortable<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!signal) return run();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (err: unknown) => { signal.removeEventListener('abort', abort); reject(err); },
    );
  });
}

async function timed<T>(run: (signal: AbortSignal) => Promise<T>, options: RequestDeadline = {}) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 10000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  try { return await abortable(signal, () => run(signal)); }
  catch (err) {
    options.signal?.throwIfAborted();
    if (deadline.aborted) throw new Error('서버 응답 시간이 초과됐어요. 잠시 뒤 다시 시도해 주세요.');
    throw err;
  }
}

function getTimed<T>(path: string, options?: RequestDeadline) {
  return timed((signal) => request<T>(path, { signal }), options);
}

export const api = {
  login: '/auth/google',
  me: () => request<{ id: Id }>('/user/me'),
  logout: () => post<void>('/auth/logout'),
  createExperience: () => post<Experience>('/experiences'),
  experience: (value: Id) => request<Experience>(experience(value)),
  end: (value: Id) => timed((signal) => post<void>(`${experience(value)}/end`, undefined, signal)),
  join: (code: string) => post<Pairing>('/device-pairings', { pairing_code: code }),
  devices: (value: Id) => request<Device[] | { devices: Device[] }>(`${experience(value)}/devices`).then(
    (data) => Array.isArray(data) ? data : data.devices,
  ),
  disconnect: (value: Id, device: Id) => request<void>(`${experience(value)}/devices/${id(device)}`, { method: 'DELETE' }),
  start: (value: Id, signal?: AbortSignal) => post<{ recording_id: Id }>(`${experience(value)}/recordings`, undefined, signal),
  video: (value: Id, file: Blob, view: View, signal?: AbortSignal) => upload<void>(
    `${recording(value)}/videos`, file, `${view}.${file.type.includes('mp4') ? 'mp4' : 'webm'}`, view, signal,
  ),
  stop: (value: Id, signal?: AbortSignal) => post<void>(`${recording(value)}/stop`, undefined, signal),
  analyseWalking: (value: Id, options?: RequestDeadline) => timed(
    (signal) => post<Analysis>(`${recording(value)}/walking-analyses`, undefined, signal), options,
  ),
  walkingStatus: (value: Id, options?: RequestDeadline) => getTimed<Analysis>(walking(value), options),
  walkingResult: (value: Id, options?: RequestDeadline) => getTimed<Feedback>(`${walking(value)}/result`, options),
  replay: (value: Id, view: View, options?: RequestDeadline) => getTimed<{ url: string }>(`${walking(value)}/videos/${view}`, options),
  timeline: (value: Id, view: View, from?: number, to?: number, options?: RequestDeadline) => {
    const query = new URLSearchParams({ camera_view: view });
    if (from !== undefined) query.set('start_ms', String(from));
    if (to !== undefined) query.set('end_ms', String(to));
    return getTimed<Timeline>(`${walking(value)}/timeline?${query}`, options);
  },
  styles: () => getTimed<Style[] | { styles: Style[] }>('/fashion-styles').then(
    (data) => Array.isArray(data) ? data : data.styles,
  ),
  image: (value: Id, file: Blob, options?: RequestDeadline) => timed(
    (signal) => upload<{ image_id: Id }>(`${experience(value)}/fashion-images`, file, 'outfit.jpg', undefined, signal),
    { timeoutMs: 30000, ...options },
  ),
  quality: (value: Id, options?: RequestDeadline) => timed(
    (signal) => post<{ passed: boolean; message?: string }>(`/fashion-images/${id(value)}/quality-check`, undefined, signal), options,
  ),
  analyseFashion: (value: Id, image: Id, style: Id, options?: RequestDeadline) => timed(
    (signal) => post<Analysis>(`${experience(value)}/fashion-analyses`, { image_id: image, preferred_style_id: style }, signal), options,
  ),
  fashionStatus: (value: Id, options?: RequestDeadline) => getTimed<Analysis>(fashion(value), options),
  fashionResult: (value: Id, options?: RequestDeadline) => getTimed<Feedback>(`${fashion(value)}/results`, options),
  save: (value: Id) => timed((signal) => post<void>(`${experience(value)}/results/save`, undefined, signal)),
};

export function socketUrl(value: Id, location = window.location) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws${experience(value)}`;
}

export function pairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export async function waitForAnalysis(
  initial: Analysis,
  status: (value: Id, signal: AbortSignal) => Promise<Analysis>,
  options: { signal?: AbortSignal; interval?: number; attempts?: number; requestTimeoutMs?: number } = {},
) {
  const { signal, interval = 1500, attempts = 120 } = options;
  let current = initial;
  for (let i = 0; i <= attempts; i++) {
    signal?.throwIfAborted();
    if (current.status === 'completed' || current.status === 'succeeded') return;
    if (current.status === 'failed' || current.status === 'cancelled') throw new Error('분석을 마치지 못했어요.');
    if (i === attempts) break;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, interval);
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    current = await timed((requestSignal) => status(initial.analysis_id, requestSignal), {
      signal, timeoutMs: options.requestTimeoutMs,
    });
  }
  throw new Error('분석이 아직 끝나지 않았어요. 잠시 뒤 다시 확인해 주세요.');
}
