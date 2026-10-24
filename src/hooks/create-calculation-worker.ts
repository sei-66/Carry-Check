import type {
  CalculationRuntime,
  WorkerPort,
} from '../application/calculation-client';

let requestFallbackSequence = 0;

export function createCalculationRuntime(): CalculationRuntime {
  return {
    setTimer(callback, delayMs) {
      const timer = globalThis.setTimeout(callback, delayMs);
      return () => globalThis.clearTimeout(timer);
    },
    createRequestId() {
      return (
        globalThis.crypto?.randomUUID?.() ??
        `${globalThis.performance.now()}-${requestFallbackSequence++}`
      );
    },
    now() {
      return globalThis.performance.now();
    },
  };
}

export function createCalculationWorker(): WorkerPort {
  const worker = new Worker(
    new URL('../workers/calculation.worker.ts', import.meta.url),
    { type: 'module' },
  );
  let messageHandler: WorkerPort['onmessage'] = null;
  let errorHandler: WorkerPort['onerror'] = null;
  let messageErrorHandler: WorkerPort['onmessageerror'] = null;
  return {
    get onmessage(): WorkerPort['onmessage'] {
      return messageHandler;
    },
    set onmessage(handler: WorkerPort['onmessage']) {
      messageHandler = handler;
      worker.onmessage = handler
        ? (event) => handler({ data: event.data })
        : null;
    },
    get onerror(): WorkerPort['onerror'] {
      return errorHandler;
    },
    set onerror(handler: WorkerPort['onerror']) {
      errorHandler = handler;
      worker.onerror = handler ? (event) => handler(event) : null;
    },
    get onmessageerror(): WorkerPort['onmessageerror'] {
      return messageErrorHandler;
    },
    set onmessageerror(handler: WorkerPort['onmessageerror']) {
      messageErrorHandler = handler;
      worker.onmessageerror = handler
        ? (event) => handler({ data: event.data })
        : null;
    },
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  };
}
