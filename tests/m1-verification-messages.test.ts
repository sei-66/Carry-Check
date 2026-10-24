import { describe, expect, it } from 'vitest';
import {
  isJsonValue,
  isM1WorkerMessage,
  isM1WorkerRequest,
  M1_DEADLINES_MS,
  M1_LIFECYCLE_DELAYS_MS,
  M1_PROTOCOL_VERSION,
} from '../src/shared/m1-verification-messages';

describe('M1 verification protocol', () => {
  it('uses fixed measurement deadlines and lifecycle-only delays', () => {
    expect(M1_DEADLINES_MS).toEqual({
      bootAssets: 20_000,
      engineInit: 30_000,
      compute: 15_000,
      wholeWorkerLifetime: 70_000,
    });
    expect(M1_LIFECYCLE_DELAYS_MS).toEqual({
      engineInit: 1_500,
      computeHold: 300,
    });
  });

  it('accepts only the fixed prepare, run, and cancel request shapes', () => {
    expect(
      isM1WorkerRequest({
        type: 'prepare',
        requestId: 'prepare-1',
        profile: 'measurement',
      }),
    ).toBe(true);
    expect(
      isM1WorkerRequest({
        type: 'prepare',
        requestId: 'prepare-delay',
        profile: 'lifecycle-delay-1500ms',
      }),
    ).toBe(true);
    expect(
      isM1WorkerRequest({
        type: 'run',
        requestId: 'run-1',
        profile: 'lifecycle-hold-300ms',
      }),
    ).toBe(true);
    expect(isM1WorkerRequest({ type: 'cancel', requestId: 'run-1' })).toBe(
      true,
    );

    expect(
      isM1WorkerRequest({
        type: 'prepare',
        requestId: 'prepare-1',
        profile: 'measurement',
        delayMs: 1,
      }),
    ).toBe(false);
    expect(
      isM1WorkerRequest({
        type: 'prepare',
        requestId: 'prepare-1',
        profile: 'other',
      }),
    ).toBe(false);
    expect(
      isM1WorkerRequest({
        type: 'run',
        requestId: '',
        profile: 'measurement',
      }),
    ).toBe(false);
    expect(isM1WorkerRequest(null)).toBe(false);
    expect(isM1WorkerRequest({ type: 'calculate' })).toBe(false);
  });

  it('guards every worker response and rejects unknown fields', () => {
    expect(
      isM1WorkerMessage({
        type: 'ready',
        protocolVersion: M1_PROTOCOL_VERSION,
      }),
    ).toBe(true);
    expect(
      isM1WorkerMessage({
        type: 'stage',
        requestId: 'prepare-1',
        phase: 'engine-init',
        profile: 'lifecycle-delay-1500ms',
      }),
    ).toBe(true);
    expect(
      isM1WorkerMessage({
        type: 'stage',
        requestId: 'run-1',
        phase: 'engine-init',
        profile: 'lifecycle-hold-300ms',
      }),
    ).toBe(false);
    expect(
      isM1WorkerMessage({
        type: 'prepared',
        requestId: 'prepare-1',
        initMs: 1500,
      }),
    ).toBe(true);
    expect(
      isM1WorkerMessage({
        type: 'result',
        requestId: 'run-1',
        result: { status: 'ok', samples: [1, null, 'done'] },
        computeMs: 2.5,
      }),
    ).toBe(true);
    expect(
      isM1WorkerMessage({
        type: 'cancelled',
        requestId: 'run-1',
        phase: 'compute',
      }),
    ).toBe(true);
    expect(
      isM1WorkerMessage({
        type: 'failure',
        requestId: 'run-1',
        phase: 'compute',
        code: 'compute-failed',
        message: 'failed',
      }),
    ).toBe(true);

    expect(
      isM1WorkerMessage({
        type: 'ready',
        protocolVersion: M1_PROTOCOL_VERSION,
        extra: true,
      }),
    ).toBe(false);
    expect(
      isM1WorkerMessage({
        type: 'prepared',
        requestId: 'prepare-1',
        initMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
    expect(
      isM1WorkerMessage({
        type: 'result',
        requestId: 'run-1',
        result: Number.NaN,
        computeMs: 1,
      }),
    ).toBe(false);
    expect(isM1WorkerMessage({ type: 'unknown' })).toBe(false);
  });

  it('accepts JSON values without non-finite numbers or cycles', () => {
    const shared = { count: 1 };
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(isJsonValue({ values: [null, true, 0, 'ok', shared, shared] })).toBe(
      true,
    );
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue(cyclic)).toBe(false);
  });
});
