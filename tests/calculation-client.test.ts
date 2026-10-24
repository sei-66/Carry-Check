import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalculationClient,
  type CalculationRuntime,
  type WorkerPort,
} from '../src/application/calculation-client';
import type { CalculationRequest } from '../src/shared/calculation-messages';
import { FIXED_ROUTE, FIXED_ROUTE_METADATA } from '../src/shared/fixed-route';

class FakeWorker implements WorkerPort {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: { readonly data: unknown }) => void) | null = null;
  readonly sent: unknown[] = [];
  terminated = false;
  throwOnPostMessage = false;

  postMessage(message: unknown): void {
    if (this.throwOnPostMessage) throw new Error('postMessage failed');
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitError(): void {
    this.onerror?.({ type: 'error' });
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: undefined });
  }
}

const input = {
  widthMm: 600,
  depthMm: 1200,
  heightMm: 800,
  marginMm: 10,
};
const options = { seed: 3, maxNodes: 200, maxTimeMs: 1000 };

function createTestRuntime(prefix = 'request'): CalculationRuntime {
  let requestNumber = 0;
  return {
    createRequestId: () => `${prefix}-${requestNumber++}`,
    now: () => Date.now(),
    setTimer(callback, delayMs) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  };
}

function resultMessage(request: CalculationRequest) {
  return {
    type: 'result',
    requestId: request.requestId,
    routeId: request.routeId,
    direction: request.direction,
    modelVersion: request.modelVersion,
    input: request.input,
    result: {
      status: 'path-found',
      poses: [
        {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
        {
          position: { x: 0, y: 0, z: 1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      ],
      clearance: null,
      floorRegionIds: ['region-entry-outside', 'region-ldk-receiver'],
      seed: options.seed,
      nodesVisited: 4,
      elapsedMs: 10,
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('CalculationClient', () => {
  it.each([
    'floor-length',
    'floor-empty',
    'floor-unknown',
    'floor-start',
    'floor-goal',
    'clearance-wide',
    'obstacle-unknown',
    'attention-mismatch',
  ] as const)('rejects malformed %s path metadata', (mode) => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime(),
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    const message = resultMessage(worker.sent[0] as CalculationRequest);
    if (mode === 'floor-length') message.result.floorRegionIds = [];
    if (mode === 'floor-empty')
      message.result.floorRegionIds = ['', 'region-end'];
    if (mode === 'floor-unknown')
      message.result.floorRegionIds = ['unknown-region', 'region-ldk-receiver'];
    if (mode === 'floor-start')
      message.result.floorRegionIds[0] = 'region-entry-threshold';
    if (mode === 'floor-goal')
      message.result.floorRegionIds[1] = 'region-entry-threshold';
    worker.emit(
      mode === 'clearance-wide' ||
        mode === 'obstacle-unknown' ||
        mode === 'attention-mismatch'
        ? {
            ...message,
            result: {
              ...message.result,
              clearance: {
                lowerBoundM: 0,
                upperBoundM: mode === 'clearance-wide' ? 0.1 : 0.0005,
                obstacleId: null,
                attention: {
                  segmentIndex: 0,
                  fraction: 0.5,
                  pose: {
                    position: {
                      x: 0,
                      y: 0,
                      z: mode === 'attention-mismatch' ? 0.75 : 0.5,
                    },
                    rotation: { x: 0, y: 0, z: 0, w: 1 },
                  },
                  obstacleId:
                    mode === 'obstacle-unknown' ? 'unknown-obstacle' : null,
                },
              },
            },
          }
        : message,
    );
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'invalid-response',
    });
  });
  it('separates engine initialization from computation, and stage notifications never extend the deadline', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime(),
      initializationTimeoutMs: 100,
      engineInitializationTimeoutMs: 50,
      calculationTimeoutMs: 30,
      workerLifetimeMs: 500,
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    vi.advanceTimersByTime(40);
    const request = worker.sent[0] as CalculationRequest;
    worker.emit({
      ...request,
      type: 'progress',
      stage: 'searching',
      nodesVisited: 0,
      elapsedMs: 0,
    });
    vi.advanceTimersByTime(29);
    worker.emit({
      ...request,
      type: 'progress',
      stage: 'verifying',
      nodesVisited: 1,
      elapsedMs: 29,
    });
    vi.advanceTimersByTime(1);
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'calculation-timeout',
    });
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a result after its absolute deadline even if the timeout callback is delayed', () => {
    vi.useFakeTimers();
    let now = 0;
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: { ...createTestRuntime(), now: () => now },
      engineInitializationTimeoutMs: 10,
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    now = 10;
    worker.emit(resultMessage(worker.sent[0] as CalculationRequest));
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'engine-initialization-timeout',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a generation lifetime across engine and compute phases', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime(),
      workerLifetimeMs: 50,
    });
    client.calculate(input, options);
    vi.advanceTimersByTime(20);
    worker.emit({ type: 'ready' });
    const request = worker.sent[0] as CalculationRequest;
    vi.advanceTimersByTime(20);
    worker.emit({
      ...request,
      type: 'progress',
      stage: 'searching',
      nodesVisited: 0,
      elapsedMs: 0,
    });
    vi.advanceTimersByTime(10);
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'worker-lifetime-timeout',
    });
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for readiness before sending a validated calculation and accepts a matching result', () => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('request'),
    });
    const states: string[] = [];
    client.subscribe((state) => states.push(state.status));

    expect(client.calculate(input, options)).toBe('request-0');
    expect(client.getState().status).toBe('initializing');
    expect(worker.sent).toHaveLength(0);

    worker.emit({ type: 'ready' });
    expect(worker.sent).toHaveLength(1);
    const request = worker.sent[0] as CalculationRequest;
    expect(request).toMatchObject({
      type: 'calculate',
      requestId: 'request-0',
      ...FIXED_ROUTE_METADATA,
    });

    worker.emit({
      type: 'progress',
      requestId: request.requestId,
      routeId: request.routeId,
      direction: request.direction,
      modelVersion: request.modelVersion,
      input: request.input,
      stage: 'searching',
      nodesVisited: 1,
      elapsedMs: 1,
    });
    expect(client.getState()).toMatchObject({
      status: 'running',
      stage: 'searching',
    });

    worker.emit(resultMessage(request));
    expect(client.getState()).toMatchObject({ status: 'result' });
    expect(worker.terminated).toBe(true);
    expect(states).toEqual([
      'idle',
      'initializing',
      'running',
      'running',
      'result',
    ]);
    client.dispose();
  });

  it('rejects invalid input before creating a worker', () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const client = new CalculationClient({
      createWorker,
      runtime: createTestRuntime('invalid-input'),
    });

    client.calculate({ ...input, widthMm: Number.NaN }, options);

    expect(createWorker).not.toHaveBeenCalled();
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'input-invalid',
    });
    client.dispose();
  });

  it('ignores stale responses and replaces a running worker for a new request', () => {
    const workers: [FakeWorker, FakeWorker] = [
      new FakeWorker(),
      new FakeWorker(),
    ];
    let id = 0;
    const client = new CalculationClient({
      createWorker: () => {
        const worker = workers[id++];
        if (!worker) throw new Error('No fake worker remains');
        return worker;
      },
      runtime: createTestRuntime('stale'),
    });
    client.calculate(input, options);
    const oldWorker = workers[0];
    const oldHandler = oldWorker.onmessage;
    oldWorker.emit({ type: 'ready' });
    const oldRequest = oldWorker.sent[0] as CalculationRequest;

    client.calculate(input, options);
    expect(oldWorker.terminated).toBe(true);
    const currentWorker = workers[1];
    currentWorker.emit({ type: 'ready' });
    const currentRequest = currentWorker.sent[0] as CalculationRequest;
    oldHandler?.({ data: resultMessage(oldRequest) });
    expect(client.getState()).toMatchObject({
      status: 'running',
      request: currentRequest,
    });

    currentWorker.emit(resultMessage(currentRequest));
    expect(client.getState()).toMatchObject({ status: 'result' });
    client.dispose();
  });

  it('rejects a matching response whose result payload is malformed', () => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('bad-result'),
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    const request = worker.sent[0] as CalculationRequest;
    const validResult = resultMessage(request);
    worker.emit({
      ...validResult,
      result: {
        ...validResult.result,
        poses: [{ position: { x: Number.NaN, y: 0, z: 0 }, rotation: {} }],
      },
    });
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'invalid-response',
    });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it('accepts the fixed route model-unavailable failure without a path result', () => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('model-unavailable'),
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    const request = worker.sent[0] as CalculationRequest;
    worker.emit({
      type: 'failure',
      requestId: request.requestId,
      routeId: request.routeId,
      direction: request.direction,
      modelVersion: request.modelVersion,
      input: request.input,
      code: 'model-unavailable',
      message: 'The fixed route model is not implemented.',
    });

    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'model-unavailable',
      request: { ...FIXED_ROUTE_METADATA },
    });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it.each([
    { field: 'routeId', metadata: { routeId: 'other-route' } },
    { field: 'direction', metadata: { direction: 'room-to-entry' } },
    {
      field: 'modelVersion',
      metadata: { modelVersion: 'maisonette-assumed-v2' },
    },
  ])(
    'rejects a response with changed $field metadata for the active request',
    ({ metadata }) => {
      const worker = new FakeWorker();
      const client = new CalculationClient({
        createWorker: () => worker,
        runtime: createTestRuntime(`wrong-${Object.keys(metadata)[0]}`),
      });
      client.calculate(input, options);
      worker.emit({ type: 'ready' });
      const request = worker.sent[0] as CalculationRequest;
      worker.emit({ ...resultMessage(request), ...metadata });

      expect(client.getState()).toMatchObject({
        status: 'failed',
        code: 'invalid-response',
      });
      expect(worker.terminated).toBe(true);
      client.dispose();
    },
  );

  it('terminates on initialization timeout and permits a later retry', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('retry'),
      initializationTimeoutMs: 20,
    });

    client.calculate(input, options);
    vi.advanceTimersByTime(20);
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'initialization-timeout',
    });
    expect(worker.terminated).toBe(true);

    const retryWorker = new FakeWorker();
    const retryClient = new CalculationClient({
      createWorker: () => retryWorker,
      runtime: createTestRuntime('retry-again'),
    });
    retryClient.calculate(input, options);
    retryWorker.emit({ type: 'ready' });
    expect(retryWorker.sent).toHaveLength(1);
    client.dispose();
    retryClient.dispose();
  });

  it('times out an unresponsive running worker and retries on the same client', () => {
    vi.useFakeTimers();
    const workers: [FakeWorker, FakeWorker] = [
      new FakeWorker(),
      new FakeWorker(),
    ];
    let workerIndex = 0;
    const client = new CalculationClient({
      createWorker: () => {
        const worker = workers[workerIndex++];
        if (!worker) throw new Error('No fake worker remains');
        return worker;
      },
      runtime: createTestRuntime('running-timeout'),
      calculationTimeoutMs: 20,
    });

    client.calculate(input, options);
    workers[0].emit({ type: 'ready' });
    const runningRequest = workers[0].sent[0] as CalculationRequest;
    workers[0].emit({
      ...runningRequest,
      type: 'progress',
      stage: 'searching',
      nodesVisited: 0,
      elapsedMs: 0,
    });
    expect(client.getState()).toMatchObject({ status: 'running' });
    vi.advanceTimersByTime(20);
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'calculation-timeout',
    });
    expect(workers[0].terminated).toBe(true);

    client.calculate(input, options);
    workers[1].emit({ type: 'ready' });
    expect(workers[1].sent).toHaveLength(1);
    expect(client.getState()).toMatchObject({ status: 'running' });
    client.dispose();
  });

  it.each(['error', 'messageerror'] as const)(
    'terminates after %s and allows retry on the same client',
    (failureKind) => {
      const workers: [FakeWorker, FakeWorker] = [
        new FakeWorker(),
        new FakeWorker(),
      ];
      let workerIndex = 0;
      const client = new CalculationClient({
        createWorker: () => {
          const worker = workers[workerIndex++];
          if (!worker) throw new Error('No fake worker remains');
          return worker;
        },
        runtime: createTestRuntime(`worker-${failureKind}`),
      });
      client.calculate(input, options);
      workers[0].emit({ type: 'ready' });
      if (failureKind === 'error') workers[0].emitError();
      else workers[0].emitMessageError();
      expect(client.getState()).toMatchObject({ status: 'failed' });
      expect(workers[0].terminated).toBe(true);

      client.calculate(input, options);
      workers[1].emit({ type: 'ready' });
      expect(workers[1].sent).toHaveLength(1);
      expect(client.getState()).toMatchObject({ status: 'running' });
      client.dispose();
    },
  );

  it('fails if posting the calculation request throws', () => {
    const worker = new FakeWorker();
    worker.throwOnPostMessage = true;
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('post-failure'),
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    expect(client.getState()).toMatchObject({
      status: 'failed',
      code: 'worker-error',
    });
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it.each(['result', 'progress'] as const)(
    'rejects a matching %s message received before ready',
    (messageType) => {
      const worker = new FakeWorker();
      const client = new CalculationClient({
        createWorker: () => worker,
        runtime: createTestRuntime(`early-${messageType}`),
      });
      client.calculate(input, options);
      const state = client.getState();
      if (state.status !== 'initializing')
        throw new Error('Expected init state');
      const { request } = state;
      worker.emit(
        messageType === 'result'
          ? resultMessage(request)
          : {
              type: 'progress',
              requestId: request.requestId,
              routeId: request.routeId,
              direction: request.direction,
              modelVersion: request.modelVersion,
              input: request.input,
              stage: 'searching',
              nodesVisited: 2,
              elapsedMs: 1,
            },
      );
      expect(client.getState()).toMatchObject({
        status: 'failed',
        code: 'invalid-response',
      });
      expect(worker.terminated).toBe(true);
      client.dispose();
    },
  );

  it('cancels by terminating the worker and dispose prevents future jobs', () => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('cancel'),
    });
    const listener = vi.fn();
    client.subscribe(listener);
    client.calculate(input, options);
    client.cancel();
    expect(client.getState()).toMatchObject({ status: 'cancelled' });
    expect(worker.terminated).toBe(true);
    client.dispose();
    const notifiedBeforeInvalidation = listener.mock.calls.length;
    client.invalidateInput();
    expect(listener).toHaveBeenCalledTimes(notifiedBeforeInvalidation);
    expect(client.calculate(input, options)).toBeUndefined();
  });

  it('invalidates input by terminating an active worker and resets result state', () => {
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('invalidate'),
    });
    client.calculate(input, options);
    client.invalidateInput();
    expect(worker.terminated).toBe(true);
    expect(client.getState()).toEqual({ status: 'idle' });

    const nextWorker = new FakeWorker();
    const nextClient = new CalculationClient({
      createWorker: () => nextWorker,
      runtime: createTestRuntime('result-invalidate'),
    });
    nextClient.calculate(input, options);
    nextWorker.emit({ type: 'ready' });
    const request = nextWorker.sent[0] as CalculationRequest;
    nextWorker.emit(resultMessage(request));
    expect(nextClient.getState().status).toBe('result');
    nextClient.invalidateInput();
    expect(nextClient.getState()).toEqual({ status: 'idle' });
    nextClient.dispose();
  });

  it('makes a frozen input and options snapshot before posting a request', () => {
    const worker = new FakeWorker();
    const mutableInput = { ...input };
    const mutableOptions = { ...options };
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('snapshot'),
    });
    client.calculate(mutableInput, mutableOptions);
    mutableInput.widthMm = 900;
    mutableOptions.seed = 99;
    worker.emit({ type: 'ready' });

    const request = worker.sent[0] as CalculationRequest;
    expect(request.input.widthMm).toBe(600);
    expect(request.options.seed).toBe(3);
    expect(request.input).not.toBe(mutableInput);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.input)).toBe(true);
    expect(Object.isFrozen(request.options)).toBe(true);
    client.dispose();
  });

  it('keeps a new job created by a result subscriber alive', () => {
    const workers: [FakeWorker, FakeWorker] = [
      new FakeWorker(),
      new FakeWorker(),
    ];
    let workerIndex = 0;
    const client = new CalculationClient({
      createWorker: () => {
        const worker = workers[workerIndex++];
        if (!worker) throw new Error('No fake worker remains');
        return worker;
      },
      runtime: createTestRuntime('reentrant-result'),
    });
    let startedNext = false;
    client.subscribe((state) => {
      if (state.status === 'result' && !startedNext) {
        startedNext = true;
        client.calculate(input, options);
      }
    });
    client.calculate(input, options);
    workers[0].emit({ type: 'ready' });
    const request = workers[0].sent[0] as CalculationRequest;
    workers[0].emit(resultMessage(request));

    expect(workers[0].terminated).toBe(true);
    expect(client.getState()).toMatchObject({
      status: 'initializing',
      request: { routeId: FIXED_ROUTE.id },
    });
    expect(workers[1].terminated).toBe(false);
    workers[1].emit({ type: 'ready' });
    expect(workers[1].sent).toHaveLength(1);
    client.dispose();
  });

  it('keeps a new job created by a failure subscriber alive', () => {
    const workers: [FakeWorker, FakeWorker] = [
      new FakeWorker(),
      new FakeWorker(),
    ];
    let workerIndex = 0;
    const client = new CalculationClient({
      createWorker: () => {
        const worker = workers[workerIndex++];
        if (!worker) throw new Error('No fake worker remains');
        return worker;
      },
      runtime: createTestRuntime('reentrant-failure'),
    });
    let startedNext = false;
    client.subscribe((state) => {
      if (state.status === 'failed' && !startedNext) {
        startedNext = true;
        client.calculate(input, options);
      }
    });
    client.calculate(input, options);
    workers[0].emit({ type: 'ready' });
    const request = workers[0].sent[0] as CalculationRequest;
    workers[0].emit({
      type: 'failure',
      requestId: request.requestId,
      routeId: request.routeId,
      direction: request.direction,
      modelVersion: request.modelVersion,
      input: request.input,
      code: 'calculation-error',
      message: 'synthetic error',
    });

    expect(workers[0].terminated).toBe(true);
    expect(client.getState()).toMatchObject({
      status: 'initializing',
      request: { routeId: FIXED_ROUTE.id },
    });
    expect(workers[1].terminated).toBe(false);
    client.dispose();
  });

  it('does not let a cancelled initialization publish or attach an old timer', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('init-reentry'),
      initializationTimeoutMs: 10,
    });
    client.subscribe((state) => {
      if (state.status === 'initializing') client.invalidateInput();
    });
    client.calculate(input, options);
    expect(client.getState()).toEqual({ status: 'idle' });
    expect(worker.terminated).toBe(true);
    vi.advanceTimersByTime(20);
    expect(client.getState()).toEqual({ status: 'idle' });
    client.dispose();
  });

  it('does not attach an obsolete calculation timer after a running listener invalidates input', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new CalculationClient({
      createWorker: () => worker,
      runtime: createTestRuntime('running-reentry'),
      calculationTimeoutMs: 10,
    });
    client.subscribe((state) => {
      if (state.status === 'running') client.invalidateInput();
    });
    client.calculate(input, options);
    worker.emit({ type: 'ready' });
    expect(worker.terminated).toBe(true);
    expect(client.getState()).toEqual({ status: 'idle' });
    vi.advanceTimersByTime(20);
    expect(client.getState()).toEqual({ status: 'idle' });
    client.dispose();
  });

  it('rejects progress beyond the requested node limit and non-finite elapsed values', () => {
    for (const elapsedMs of [1, Number.POSITIVE_INFINITY]) {
      const worker = new FakeWorker();
      const client = new CalculationClient({
        createWorker: () => worker,
        runtime: createTestRuntime(`progress-${elapsedMs}`),
      });
      client.calculate(input, { ...options, maxNodes: 2 });
      worker.emit({ type: 'ready' });
      const request = worker.sent[0] as CalculationRequest;
      worker.emit({
        type: 'progress',
        requestId: request.requestId,
        routeId: request.routeId,
        direction: request.direction,
        modelVersion: request.modelVersion,
        input: request.input,
        stage: 'searching',
        nodesVisited: 3,
        elapsedMs,
      });
      expect(client.getState()).toMatchObject({
        status: 'failed',
        code: 'invalid-response',
      });
      expect(worker.terminated).toBe(true);
      client.dispose();
    }
  });
});
