import { waitForAnalysis } from './api.ts';
import type { Analysis, Feedback, Id } from './api.ts';

export function createAnalysisTask({
  start, status, result, pollInterval,
}: {
  start: (signal: AbortSignal) => Promise<Analysis>;
  status: (id: Id, signal: AbortSignal) => Promise<Analysis>;
  result: (id: Id, signal: AbortSignal) => Promise<Feedback>;
  pollInterval?: number;
}) {
  let job: Analysis | undefined;
  let feedback: Feedback | undefined;
  let active: { controller: AbortController; promise: Promise<Feedback> } | undefined;

  return {
    get id() { return job?.analysis_id; },
    run() {
      if (feedback) return Promise.resolve(feedback);
      if (active) return active.promise;
      const controller = new AbortController();
      const { signal } = controller;
      const promise = (async () => {
        if (!job || job.status === 'failed' || job.status === 'cancelled') {
          const created = await start(signal);
          signal.throwIfAborted();
          job = created;
        }
        const id = job.analysis_id;
        await waitForAnalysis(job, async (value, requestSignal) => {
          const updated = await status(value, requestSignal);
          requestSignal.throwIfAborted();
          return job = { ...updated, analysis_id: value };
        }, { signal, interval: pollInterval });
        signal.throwIfAborted();
        const loaded = await result(id, signal);
        signal.throwIfAborted();
        return feedback = loaded;
      })().finally(() => {
        if (active?.controller === controller) active = undefined;
      });
      active = { controller, promise };
      return promise;
    },
    cancel() {
      const previous = active;
      active = undefined;
      previous?.controller.abort();
    },
  };
}
