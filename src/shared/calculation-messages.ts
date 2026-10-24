import type { InputSnapshot } from '../domain/dimensions';
import type { Pose } from '../domain/pose';
import {
  FIXED_ROUTE,
  type FixedRouteDirection,
  type FixedRouteId,
  type FixedRouteModelVersion,
} from './fixed-route';

export const MIN_CALCULATION_NODES = 2;
export const MAX_CALCULATION_NODES = 20_000;
export const MAX_CALCULATION_SEED = 0xffff_ffff;
export const MAX_CALCULATION_TIME_MS = 30_000;

export interface CalculationOptions {
  readonly seed: number;
  readonly maxNodes: number;
  readonly maxTimeMs: number;
}

export interface CalculationRequest {
  readonly type: 'calculate';
  readonly requestId: string;
  readonly routeId: FixedRouteId;
  readonly direction: FixedRouteDirection;
  readonly modelVersion: FixedRouteModelVersion;
  readonly input: InputSnapshot;
  readonly options: CalculationOptions;
}

export interface CalculationMetadata {
  readonly requestId: string;
  readonly routeId: string;
  readonly direction: string;
  readonly modelVersion: string;
  readonly input: InputSnapshot;
}

export interface WorkerReadyMessage {
  readonly type: 'ready';
}

export interface CalculationProgressMessage extends CalculationMetadata {
  readonly type: 'progress';
  readonly stage: 'initializing' | 'searching' | 'verifying';
  readonly nodesVisited: number;
  readonly elapsedMs: number;
}

export interface FoundClearance {
  readonly lowerBoundM: number;
  readonly upperBoundM: number;
  readonly obstacleId: string | null;
  readonly attention: {
    readonly segmentIndex: number;
    readonly fraction: number;
    readonly pose: Pose;
    readonly obstacleId: string | null;
  };
}

export interface PathFoundResult {
  readonly status: 'path-found';
  readonly poses: readonly Pose[];
  readonly floorRegionIds: readonly string[];
  readonly clearance: FoundClearance | null;
  readonly seed: number;
  readonly nodesVisited: number;
  readonly elapsedMs: number;
}

export interface PathNotFoundResult {
  readonly status: 'path-not-found';
  readonly reason:
    | 'node-limit'
    | 'time-limit'
    | 'no-path'
    | 'start-invalid'
    | 'goal-invalid'
    | 'verification-limit';
  readonly seed: number;
  readonly nodesVisited: number;
  readonly elapsedMs: number;
}

export interface CalculationResultMessage extends CalculationMetadata {
  readonly type: 'result';
  readonly result: PathFoundResult | PathNotFoundResult;
}

export type CalculationFailureCode =
  | 'input-invalid'
  | 'model-invalid'
  | 'model-unavailable'
  | 'unsupported-route'
  | 'unsupported-direction'
  | 'unsupported-model-version'
  | 'invalid-request'
  | 'calculation-error';

export interface CalculationFailureMessage extends CalculationMetadata {
  readonly type: 'failure';
  readonly code: CalculationFailureCode;
  readonly message: string;
}

export type CalculationWorkerMessage =
  | WorkerReadyMessage
  | CalculationProgressMessage
  | CalculationResultMessage
  | CalculationFailureMessage;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCalculationOptions(
  value: unknown,
): value is CalculationOptions {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.seed) &&
    (value.seed as number) >= 0 &&
    (value.seed as number) <= MAX_CALCULATION_SEED &&
    Number.isSafeInteger(value.maxNodes) &&
    (value.maxNodes as number) >= MIN_CALCULATION_NODES &&
    (value.maxNodes as number) <= MAX_CALCULATION_NODES &&
    Number.isFinite(value.maxTimeMs) &&
    (value.maxTimeMs as number) >= 1 &&
    (value.maxTimeMs as number) <= MAX_CALCULATION_TIME_MS
  );
}

export function isInputSnapshot(value: unknown): value is InputSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.widthMm === 'number' &&
    Number.isFinite(value.widthMm) &&
    typeof value.depthMm === 'number' &&
    Number.isFinite(value.depthMm) &&
    typeof value.heightMm === 'number' &&
    Number.isFinite(value.heightMm) &&
    typeof value.marginMm === 'number' &&
    Number.isFinite(value.marginMm)
  );
}

export function isCalculationRequest(
  value: unknown,
): value is CalculationRequest {
  if (!isRecord(value)) return false;
  const allowedKeys = [
    'type',
    'requestId',
    'routeId',
    'direction',
    'modelVersion',
    'input',
    'options',
  ];
  if (
    Object.keys(value).length !== allowedKeys.length ||
    !allowedKeys.every((key) => Object.hasOwn(value, key))
  )
    return false;
  return (
    value.type === 'calculate' &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 128 &&
    value.routeId === FIXED_ROUTE.id &&
    value.direction === FIXED_ROUTE.direction &&
    value.modelVersion === FIXED_ROUTE.modelVersion &&
    isInputSnapshot(value.input) &&
    isCalculationOptions(value.options)
  );
}

export function sameInputSnapshot(
  left: InputSnapshot,
  right: InputSnapshot,
): boolean {
  return (
    Object.is(left.widthMm, right.widthMm) &&
    Object.is(left.depthMm, right.depthMm) &&
    Object.is(left.heightMm, right.heightMm) &&
    Object.is(left.marginMm, right.marginMm)
  );
}
