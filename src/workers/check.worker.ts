import type { WorkerRequest, WorkerResponse } from '../shared/worker-messages';

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'ping') {
    self.postMessage({ type: 'pong' } satisfies WorkerResponse);
  }
};
