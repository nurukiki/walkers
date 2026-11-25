import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, pairingCode, socketUrl, waitForAnalysis } from '../static/api.ts';

test('normalizes an alphanumeric six-digit pairing code', () => {
  assert.equal(pairingCode(' k-7m 4!q2zz'), 'K7M4Q2');
  assert.equal(pairingCode('한글 ab'), 'AB');
});

test('uses the same origin and upgrades the socket scheme for HTTPS', () => {
  assert.equal(socketUrl('a/b', new URL('https://example.test:8443')), 'wss://example.test:8443/ws/experiences/a%2Fb');
});

test('uses the documented JSON and multipart fields', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (path) => new Response(
    path === '/device-pairings' ? '{"device_id":"d","experience_id":"e"}' : undefined,
  ));
  assert.deepEqual(await api.join('K7M4Q2'), { device_id: 'd', experience_id: 'e' });
  await api.video('r/a', new Blob(['video'], { type: 'video/webm' }), 'side');
  await api.analyseFashion('e', 42, 'casual');
  await api.timeline('x', 'front', 0, 800);
  const [[joinPath, join], [videoPath, video], [fashionPath, fashion], [timelinePath]] =
    fetchMock.mock.calls.map((call) => call.arguments);
  assert.equal(joinPath, '/device-pairings');
  assert.deepEqual(JSON.parse(join.body), { pairing_code: 'K7M4Q2' });
  assert.equal(videoPath, '/recordings/r%2Fa/videos');
  assert.equal(video.body.get('camera_view'), 'side');
  assert.equal(video.body.get('file').name, 'side.webm');
  assert.equal(fashionPath, '/experiences/e/fashion-analyses');
  assert.deepEqual(JSON.parse(fashion.body), { image_id: 42, preferred_style_id: 'casual' });
  assert.equal(timelinePath, '/walking-analyses/x/timeline?camera_view=front&start_ms=0&end_ms=800');
});

test('retains the API status and server error detail', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Invalid code' }, { status: 404 }));
  await assert.rejects(api.join('X1X2X3'), (err) => err instanceof ApiError && err.status === 404 && err.message === 'Invalid code');
});

test('polls an analysis until it completes and stops on failure or abort', async () => {
  const pending = { analysis_id: 'w', status: 'queued' };
  const seen = [];
  await waitForAnalysis(pending, async (id) => {
    seen.push(id);
    return { analysis_id: id, status: seen.length < 2 ? 'running' : 'completed' };
  }, { interval: 1 });
  assert.deepEqual(seen, ['w', 'w']);
  await assert.rejects(waitForAnalysis({ ...pending, status: 'failed' }, () => assert.fail()), /분석/);
  const abort = new AbortController();
  const result = waitForAnalysis(pending, () => assert.fail(), { signal: abort.signal });
  abort.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('cancels an already pending status fetch, not only the polling delay', { timeout: 500 }, async (t) => {
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let fetchSignal;
  t.mock.method(globalThis, 'fetch', (_path, { signal }) => {
    fetchSignal = signal;
    markStarted();
    return new Promise(() => {}); // Also exercise a transport that never settles.
  });
  const controller = new AbortController();
  const result = waitForAnalysis({ analysis_id: 'pending', status: 'queued' },
    (id, signal) => api.walkingStatus(id, { signal }), { interval: 0, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(fetchSignal.aborted, true);
});

test('analysis submissions and result reads time out even while reading the response body', async (t) => {
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (_path, { signal }) => {
    signals.push(signal);
    return new Response(new ReadableStream({}));
  });
  const keepAlive = setTimeout(() => {}, 250);
  t.after(() => clearTimeout(keepAlive));
  const options = { timeoutMs: 10 };
  const requests = [
    api.analyseWalking('r', options), api.walkingStatus('w', options), api.walkingResult('w', options),
    api.analyseFashion('e', 'image', 'style', options), api.fashionStatus('f', options), api.fashionResult('f', options),
  ];
  await Promise.all(requests.map((request) => assert.rejects(request, /응답 시간이 초과/)));
  assert.equal(signals.length, requests.length);
  assert.ok(signals.every((signal) => signal.aborted));
});
