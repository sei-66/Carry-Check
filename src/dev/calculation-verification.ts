import {
  CalculationClient,
  type CalculationState,
  type WorkerPort,
} from '../application/calculation-client';
import type { InputSnapshot } from '../domain/dimensions';
import {
  createCalculationRuntime,
  createCalculationWorker,
} from '../hooks/create-calculation-worker';
import type { CalculationRequest } from '../shared/calculation-messages';
import { FIXED_ROUTE, FIXED_ROUTE_METADATA } from '../shared/fixed-route';

const output = document.querySelector('#verification-output');
if (!(output instanceof HTMLElement)) throw new Error('Missing output');
const verificationOutput = output;
const lines: string[] = [navigator.userAgent];
function record(value: unknown) {
  lines.push(JSON.stringify(value));
  verificationOutput.textContent = lines.join('\n');
}

const options = { seed: 20261003, maxNodes: 5000, maxTimeMs: 15000 };
const input: InputSnapshot = {
  widthMm: 120,
  heightMm: 140,
  depthMm: 180,
  marginMm: 10,
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fixedRequest(overrides: Record<string, unknown> = {}) {
  return {
    type: 'calculate',
    requestId: 'verification-request',
    ...FIXED_ROUTE_METADATA,
    input,
    options,
    ...overrides,
  };
}

function requestWorker(payload: unknown): Promise<Record<string, unknown>> {
  const worker = createCalculationWorker();
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Worker boundary timeout')),
      40_000,
    );
    worker.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Worker boundary error'));
    };
    worker.onmessage = (event) => {
      const value = event.data as Record<string, unknown>;
      if (value.type === 'ready') {
        worker.postMessage(payload);
      } else if (value.type !== 'progress') {
        clearTimeout(timeout);
        resolve(value);
      }
    };
  }).finally(() => worker.terminate());
}

async function expectFailure(name: string, payload: unknown, code: string) {
  const response = await requestWorker(payload);
  assert(response.type === 'failure', `${name}: expected a failure response`);
  assert(
    response.code === code,
    `${name}: unexpected code ${String(response.code)}`,
  );
  record({ test: name, code: response.code });
}

function calculate(
  client: CalculationClient,
  dimensions: InputSnapshot,
): Promise<CalculationState> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    unsubscribe = client.subscribe((state) => {
      if (state.status === 'result' || state.status === 'failed') {
        unsubscribe();
        resolve(state);
      }
    });
    client.calculate(dimensions, options);
  });
}

async function verifyWorkerBoundary() {
  const valid: CalculationRequest = {
    type: 'calculate',
    requestId: 'verification-request',
    ...FIXED_ROUTE_METADATA,
    input,
    options,
  };
  const response = await requestWorker(valid);
  assert(response.type === 'result', 'Expected a housing calculation result');
  assert(
    typeof response.result === 'object' &&
      response.result !== null &&
      'status' in response.result &&
      response.result.status === 'path-found',
    'Small package route was not found',
  );
  assert(response.routeId === FIXED_ROUTE.id, 'Route metadata was changed');
  assert(
    response.direction === FIXED_ROUTE.direction,
    'Direction metadata was changed',
  );
  record({
    test: 'fixed-route-assumed-model',
    result: response.result,
    modelVersion: response.modelVersion,
  });

  await expectFailure(
    'worker-input-boundary',
    fixedRequest({ input: { ...input, widthMm: 0 } }),
    'input-invalid',
  );
  await expectFailure(
    'worker-budget-boundary',
    fixedRequest({ options: { ...options, maxNodes: 1 } }),
    'invalid-request',
  );
  await expectFailure(
    'worker-request-id-boundary',
    fixedRequest({ requestId: '' }),
    'invalid-request',
  );
  await expectFailure(
    'unsupported-route',
    fixedRequest({ routeId: 'other-route' }),
    'unsupported-route',
  );
  await expectFailure(
    'unsupported-direction',
    fixedRequest({ direction: 'room-to-entry' }),
    'unsupported-direction',
  );
  await expectFailure(
    'unsupported-model-version',
    fixedRequest({ modelVersion: 'future-v2' }),
    'unsupported-model-version',
  );
  await expectFailure(
    'previous-assumed-model-version',
    fixedRequest({ modelVersion: 'maisonette-assumed-v2' }),
    'unsupported-model-version',
  );
  await expectFailure(
    'removed-scenario-contract',
    fixedRequest({ scenarioId: 'straight' }),
    'invalid-request',
  );
}

async function verifyClientLifecycle() {
  let created = 0;
  let terminated = 0;
  const client = new CalculationClient({
    runtime: createCalculationRuntime(),
    createWorker(): WorkerPort {
      created++;
      const worker = createCalculationWorker();
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminated++;
        terminate();
      };
      return worker;
    },
  });
  try {
    for (let index = 0; index < 20; index++) {
      client.calculate(input, options);
      client.cancel();
      client.invalidateInput();
    }
    const state = await calculate(client, input);
    assert(
      state.status === 'result' && state.message.result.status === 'path-found',
      `Expected a verified small package path, received ${JSON.stringify(state)}`,
    );
    record({
      test: 'cancel-recreate-20',
      created,
      terminated,
      retry: state.message.result.status,
    });
  } finally {
    client.dispose();
  }
  assert(created === terminated, 'Workers leaked');
  record({
    status: 'PASS',
    created,
    terminated,
    note: '仮定住宅の小箱経路と実Workerを確認。実測・実機タッチ・保持メモリは未確認',
  });
}

async function run() {
  await verifyWorkerBoundary();
  await verifyClientLifecycle();
}

void run().catch((error: unknown) => {
  record({ status: 'FAIL', error: String(error) });
  console.error(error);
});
