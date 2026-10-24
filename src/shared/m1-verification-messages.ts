export const M1_PROTOCOL_VERSION = 1;

// Dedicated bootstrap timeout probe; it is not an asset-load performance sample.
export const M1_BOOT_DEADLINE_HOLD_MS = 1_500;

export const M1_DEADLINES_MS = {
  bootAssets: 20_000,
  engineInit: 30_000,
  compute: 15_000,
  wholeWorkerLifetime: 70_000,
} as const;

export const M1_LIFECYCLE_DELAYS_MS = {
  engineInit: 1_500,
  computeHold: 300,
} as const;

export type M1Phase = 'boot-assets' | 'engine-init' | 'compute' | 'protocol';

export type M1PrepareProfile = 'measurement' | 'lifecycle-delay-1500ms';
export type M1RunProfile = 'measurement' | 'lifecycle-hold-300ms';

export interface M1PrepareRequest {
  readonly type: 'prepare';
  readonly requestId: string;
  readonly profile: M1PrepareProfile;
}

export interface M1RunRequest {
  readonly type: 'run';
  readonly requestId: string;
  readonly profile: M1RunProfile;
}

export interface M1CancelRequest {
  readonly type: 'cancel';
  readonly requestId: string;
}

export type M1WorkerRequest = M1PrepareRequest | M1RunRequest | M1CancelRequest;

export interface M1WorkerReadyMessage {
  readonly type: 'ready';
  readonly protocolVersion: typeof M1_PROTOCOL_VERSION;
}

export interface M1WorkerStageMessage {
  readonly type: 'stage';
  readonly requestId: string;
  readonly phase: 'engine-init' | 'compute';
  readonly profile: M1PrepareProfile | M1RunProfile;
}

export interface M1WorkerPreparedMessage {
  readonly type: 'prepared';
  readonly requestId: string;
  readonly initMs: number;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface M1WorkerResultMessage {
  readonly type: 'result';
  readonly requestId: string;
  readonly result: JsonValue;
  readonly computeMs: number;
}

export interface M1WorkerCancelledMessage {
  readonly type: 'cancelled';
  readonly requestId: string;
  readonly phase: 'engine-init' | 'compute';
}

export interface M1WorkerFailureMessage {
  readonly type: 'failure';
  readonly requestId: string;
  readonly phase: M1Phase;
  readonly code:
    | 'invalid-request'
    | 'busy'
    | 'init-failed'
    | 'compute-failed'
    | 'result-not-json-safe';
  readonly message: string;
}

export type M1WorkerMessage =
  | M1WorkerReadyMessage
  | M1WorkerStageMessage
  | M1WorkerPreparedMessage
  | M1WorkerResultMessage
  | M1WorkerCancelledMessage
  | M1WorkerFailureMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isM1WorkerRequest(value: unknown): value is M1WorkerRequest {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'prepare') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'profile']) &&
      isRequestId(value.requestId) &&
      (value.profile === 'measurement' ||
        value.profile === 'lifecycle-delay-1500ms')
    );
  }
  if (value.type === 'run') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'profile']) &&
      isRequestId(value.requestId) &&
      (value.profile === 'measurement' ||
        value.profile === 'lifecycle-hold-300ms')
    );
  }
  if (value.type === 'cancel') {
    return (
      hasExactKeys(value, ['type', 'requestId']) && isRequestId(value.requestId)
    );
  }
  return false;
}

export function isJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.every((item) => isJsonValue(item, seen, depth + 1));
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value).every((item) =>
      isJsonValue(item, seen, depth + 1),
    );
  } finally {
    seen.delete(value);
  }
}

export function isM1WorkerMessage(value: unknown): value is M1WorkerMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'ready') {
    return (
      hasExactKeys(value, ['type', 'protocolVersion']) &&
      value.protocolVersion === M1_PROTOCOL_VERSION
    );
  }
  if (value.type === 'stage') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'phase', 'profile']) &&
      isRequestId(value.requestId) &&
      ((value.phase === 'engine-init' &&
        (value.profile === 'measurement' ||
          value.profile === 'lifecycle-delay-1500ms')) ||
        (value.phase === 'compute' &&
          (value.profile === 'measurement' ||
            value.profile === 'lifecycle-hold-300ms')))
    );
  }
  if (value.type === 'prepared') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'initMs']) &&
      isRequestId(value.requestId) &&
      isFiniteNonNegative(value.initMs)
    );
  }
  if (value.type === 'result') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'result', 'computeMs']) &&
      isRequestId(value.requestId) &&
      isFiniteNonNegative(value.computeMs) &&
      isJsonValue(value.result)
    );
  }
  if (value.type === 'cancelled') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'phase']) &&
      isRequestId(value.requestId) &&
      (value.phase === 'engine-init' || value.phase === 'compute')
    );
  }
  if (value.type === 'failure') {
    return (
      hasExactKeys(value, ['type', 'requestId', 'phase', 'code', 'message']) &&
      isRequestId(value.requestId) &&
      (value.phase === 'boot-assets' ||
        value.phase === 'engine-init' ||
        value.phase === 'compute' ||
        value.phase === 'protocol') &&
      (value.code === 'invalid-request' ||
        value.code === 'busy' ||
        value.code === 'init-failed' ||
        value.code === 'compute-failed' ||
        value.code === 'result-not-json-safe') &&
      typeof value.message === 'string'
    );
  }
  return false;
}
