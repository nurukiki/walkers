import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisTask } from '../static/analysis.ts';

test('leaving and retrying an analysis reuses its existing job ID', { timeout: 500 }, async () => {
  let submitCount = 0;
  let pollCount = 0;
  let markPolling;
  const polling = new Promise((resolve) => { markPolling = resolve; });
  const task = createAnalysisTask({
    start: async () => { submitCount++; return { analysis_id: 'job', status: 'queued' }; },
    status: async (id, signal) => {
      assert.equal(id, 'job');
      if (++pollCount === 1) {
        markPolling();
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      return { analysis_id: id, status: 'completed' };
    },
    result: async (id) => ({ summary: id }),
    pollInterval: 0,
  });
  const previous = task.run();
  await polling;
  task.cancel();
  const resumed = task.run();
  await assert.rejects(previous, { name: 'AbortError' });
  assert.deepEqual(await resumed, { summary: 'job' });
  assert.equal(submitCount, 1);
});

test('a timed-out result can be fetched again without starting a new job', async () => {
  let submitCount = 0;
  let reads = 0;
  const task = createAnalysisTask({
    start: async () => { submitCount++; return { analysis_id: 'job', status: 'completed' }; },
    status: () => assert.fail('completed jobs do not need polling'),
    result: async () => {
      if (++reads === 1) throw new Error('timeout');
      return { summary: 'ok' };
    },
  });
  await assert.rejects(task.run(), /timeout/);
  assert.deepEqual(await task.run(), { summary: 'ok' });
  assert.equal(submitCount, 1);
});
