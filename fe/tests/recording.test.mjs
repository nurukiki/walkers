import assert from 'node:assert/strict';
import test from 'node:test';
import { record, RecordingError, SideRecording } from '../static/recording.ts';

class FakeRecorder extends EventTarget {
  static latest;
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'video/webm';
  stops = 0;
  constructor() { super(); FakeRecorder.latest = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.stops++; }
  emitData(content) {
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([content]) }));
  }
}

function testCamera(t) {
  const original = globalThis.MediaRecorder;
  globalThis.MediaRecorder = FakeRecorder;
  t.after(() => { globalThis.MediaRecorder = original; });
  const track = Object.assign(new EventTarget(), { readyState: 'live' });
  const media = record({ getVideoTracks: () => [track] });
  const recorder = FakeRecorder.latest;
  t.after(() => media.cancel());
  return { track, media, recorder };
}

test('does not acknowledge start until MediaRecorder emits start; valid video survives a retry', async (t) => {
  const { media, recorder } = testCamera(t);
  let started = false;
  void media.started.then(() => { started = true; });
  await Promise.resolve();
  assert.equal(started, false);
  recorder.dispatchEvent(new Event('start'));
  await media.started;
  assert.equal(started, true);
  const result = media.stop();
  recorder.emitData('valid video');
  recorder.dispatchEvent(new Event('stop'));
  assert.equal(await (await result).text(), 'valid video');
  assert.equal(await media.stop(), await result);
  assert.equal(recorder.stops, 1);
});

test('an empty take is a terminal recording error, not a failed upload', async (t) => {
  const { media, recorder } = testCamera(t);
  recorder.dispatchEvent(new Event('start'));
  await media.started;
  const result = media.stop();
  recorder.dispatchEvent(new Event('stop'));
  await assert.rejects(result, RecordingError);
});

test('recorder errors and a lost camera fail the current take', async (t) => {
  const { media, recorder } = testCamera(t);
  recorder.dispatchEvent(new Event('error'));
  await assert.rejects(media.started, RecordingError);
  await assert.rejects(media.result, RecordingError);
  const track = new EventTarget();
  const next = record({ getVideoTracks: () => [Object.assign(track, { readyState: 'live' })] });
  FakeRecorder.latest.dispatchEvent(new Event('start'));
  await next.started;
  track.dispatchEvent(new Event('ended'));
  await assert.rejects(next.result, /카메라/);
});

test('cancel stops an in-progress take and discards the file', async (t) => {
  const { media, recorder } = testCamera(t);
  recorder.dispatchEvent(new Event('start'));
  await media.started;
  media.cancel();
  assert.equal(recorder.stops, 1);
  await assert.rejects(media.result, { name: 'AbortError' });
});

test('side start requires acknowledgment for the correct take, and has a timeout', async () => {
  const side = new SideRecording('new');
  const signal = new AbortController().signal;
  side.accept({ type: 'recording_started', recording_id: 'old', camera_view: 'side' });
  await assert.rejects(side.waitFor('start', signal, 2), RecordingError);
  side.accept({ type: 'recording_started', recording_id: 'new', camera_view: 'side' });
  await side.waitFor('start', signal, 2);
});

test('side upload errors can be retried, but losing the recording cannot', async () => {
  const side = new SideRecording('take');
  const signal = new AbortController().signal;
  const event = { recording_id: 'take', camera_view: 'side' };
  side.accept({ ...event, type: 'video_upload_failed' });
  await assert.rejects(side.waitFor('upload', signal), /다시 시도/);
  assert.equal(side.retryUpload(), true);
  side.accept({ ...event, type: 'video_uploaded' });
  await side.waitFor('upload', signal);
  assert.equal(side.retryUpload(), false);

  const broken = new SideRecording('take');
  broken.accept({ ...event, type: 'recording_failed' });
  await assert.rejects(broken.waitFor('start', signal), RecordingError);
  await assert.rejects(broken.waitFor('upload', signal), RecordingError);
});
