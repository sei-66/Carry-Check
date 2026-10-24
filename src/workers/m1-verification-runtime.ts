import { prepareM1Benchmark } from '../dev/run-m1-benchmark';
import {
  isJsonValue,
  isM1WorkerRequest,
  isRecord,
  type M1Phase,
  type M1WorkerMessage,
  type M1WorkerRequest,
} from '../shared/m1-verification-messages';
import {
  M1_LIFECYCLE_DELAYS_MS,
  M1_BOOT_DEADLINE_HOLD_MS,
  M1_PROTOCOL_VERSION,
} from '../shared/m1-verification-messages';

type PreparedBenchmark = Awaited<ReturnType<typeof prepareM1Benchmark>>;

interface ActiveOperation {
  readonly requestId: string;
  readonly phase: 'engine-init' | 'compute';
  cancelled: boolean;
  cancelDelay: (() => void) | undefined;
}

let benchmark: PreparedBenchmark | undefined;
let activeOperation: ActiveOperation | undefined;

function send(message: M1WorkerMessage): void {
  self.postMessage(message);
}

function requestIdFrom(value: unknown): string {
  if (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 128
  )
    return value.requestId;
  return 'invalid-request';
}

function sendFailure(
  requestId: string,
  phase: M1Phase,
  code:
    | 'invalid-request'
    | 'busy'
    | 'init-failed'
    | 'compute-failed'
    | 'result-not-json-safe',
  error: unknown,
): void {
  send({
    type: 'failure',
    requestId,
    phase,
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

function waitForLifecycleDelay(
  operation: ActiveOperation,
  delayMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (operation.cancelled) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      operation.cancelDelay = undefined;
      resolve(true);
    }, delayMs);
    operation.cancelDelay = () => {
      clearTimeout(timer);
      operation.cancelDelay = undefined;
      resolve(false);
    };
  });
}

function complete(operation: ActiveOperation, message: M1WorkerMessage): void {
  if (activeOperation !== operation) return;
  activeOperation = undefined;
  send(message);
}

async function prepare(
  request: Extract<M1WorkerRequest, { type: 'prepare' }>,
): Promise<void> {
  const operation: ActiveOperation = {
    requestId: request.requestId,
    phase: 'engine-init',
    cancelled: false,
    cancelDelay: undefined,
  };
  activeOperation = operation;
  send({
    type: 'stage',
    requestId: request.requestId,
    phase: operation.phase,
    profile: request.profile,
  });
  const startedAt = performance.now();

  try {
    if (
      request.profile === 'lifecycle-delay-1500ms' &&
      !(await waitForLifecycleDelay(
        operation,
        M1_LIFECYCLE_DELAYS_MS.engineInit,
      ))
    ) {
      complete(operation, {
        type: 'cancelled',
        requestId: request.requestId,
        phase: operation.phase,
      });
      return;
    }
    if (operation.cancelled) {
      complete(operation, {
        type: 'cancelled',
        requestId: request.requestId,
        phase: operation.phase,
      });
      return;
    }
    if (!benchmark) benchmark = await prepareM1Benchmark();
    if (operation.cancelled) {
      complete(operation, {
        type: 'cancelled',
        requestId: request.requestId,
        phase: operation.phase,
      });
      return;
    }
    complete(operation, {
      type: 'prepared',
      requestId: request.requestId,
      initMs: performance.now() - startedAt,
    });
  } catch (error) {
    complete(operation, {
      type: 'failure',
      requestId: request.requestId,
      phase: operation.phase,
      code: 'init-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function run(
  request: Extract<M1WorkerRequest, { type: 'run' }>,
): Promise<void> {
  if (!benchmark) {
    sendFailure(
      request.requestId,
      'engine-init',
      'init-failed',
      'prepare must complete before run',
    );
    return;
  }
  const operation: ActiveOperation = {
    requestId: request.requestId,
    phase: 'compute',
    cancelled: false,
    cancelDelay: undefined,
  };
  activeOperation = operation;
  send({
    type: 'stage',
    requestId: request.requestId,
    phase: operation.phase,
    profile: request.profile,
  });

  try {
    if (
      request.profile === 'lifecycle-hold-300ms' &&
      !(await waitForLifecycleDelay(
        operation,
        M1_LIFECYCLE_DELAYS_MS.computeHold,
      ))
    ) {
      complete(operation, {
        type: 'cancelled',
        requestId: request.requestId,
        phase: operation.phase,
      });
      return;
    }
    if (operation.cancelled) {
      complete(operation, {
        type: 'cancelled',
        requestId: request.requestId,
        phase: operation.phase,
      });
      return;
    }
    const startedAt = performance.now();
    const result = benchmark.run();
    const computeMs = performance.now() - startedAt;
    if (!isJsonValue(result)) {
      complete(operation, {
        type: 'failure',
        requestId: request.requestId,
        phase: operation.phase,
        code: 'result-not-json-safe',
        message: 'Benchmark result is not a finite, acyclic JSON value',
      });
      return;
    }
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      complete(operation, {
        type: 'failure',
        requestId: request.requestId,
        phase: operation.phase,
        code: 'result-not-json-safe',
        message: 'Benchmark result could not be serialized',
      });
      return;
    }
    const jsonResult: unknown = JSON.parse(serialized);
    if (!isJsonValue(jsonResult)) {
      complete(operation, {
        type: 'failure',
        requestId: request.requestId,
        phase: operation.phase,
        code: 'result-not-json-safe',
        message: 'Serialized benchmark result failed JSON validation',
      });
      return;
    }
    complete(operation, {
      type: 'result',
      requestId: request.requestId,
      result: jsonResult,
      computeMs,
    });
  } catch (error) {
    complete(operation, {
      type: 'failure',
      requestId: request.requestId,
      phase: operation.phase,
      code: 'compute-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function announceReady(bootHold: boolean): Promise<void> {
  if (bootHold)
    await new Promise<void>((resolve) =>
      setTimeout(resolve, M1_BOOT_DEADLINE_HOLD_MS),
    );
  self.postMessage({ type: 'ready', protocolVersion: M1_PROTOCOL_VERSION });
}

export function startM1VerificationWorker(bootHold: boolean): void {
  self.onmessage = (event: MessageEvent<unknown>) => {
    const raw = event.data;
    if (!isM1WorkerRequest(raw)) {
      sendFailure(
        requestIdFrom(raw),
        'protocol',
        'invalid-request',
        'Unrecognized M1 verification message; no operation was started',
      );
      return;
    }
    if (raw.type === 'cancel') {
      if (activeOperation?.requestId === raw.requestId) {
        activeOperation.cancelled = true;
        activeOperation.cancelDelay?.();
      }
      // Completion and cancellation can cross in transit. A valid stale cancel
      // is a no-op and cannot fail a subsequent request on the same Worker.
      return;
    }
    if (activeOperation) {
      sendFailure(
        raw.requestId,
        raw.type === 'prepare' ? 'engine-init' : 'compute',
        'busy',
        'A verification operation is already running',
      );
      return;
    }
    if (raw.type === 'prepare') {
      void prepare(raw);
      return;
    }
    void run(raw);
  };

  void announceReady(bootHold);
}
