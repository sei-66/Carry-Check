import type { Pose, Vector3 } from '../domain/pose';
import type { ConvexPrism } from '../model/geometry-model';
import type { Bounds } from './scene';

// M1 error budget for synthetic coordinates within +/-20 m. Not survey accuracy.
export const NUMERICAL_ERROR_M = 0.00025;

export interface ClearanceQuery {
  readonly status: 'clear' | 'blocked';
  readonly lowerBoundM: number;
  readonly upperBoundM: number | null;
  readonly obstacleId: string;
}

export interface PoseQuery {
  readonly radius: number;
  readonly bounds: Bounds;
  query(pose: Pose, predictionM: number): ClearanceQuery;
  /** Conservative minimum gap of the entire lerp/slerp interval. */
  sweepLowerBound?(start: Pose, end: Pose): number;
}

export type PhysicalDiagnostic =
  | { readonly kind: 'measured'; readonly distanceM: number }
  | {
      readonly kind: 'out-of-range' | 'shape-unavailable' | 'query-failed';
      readonly distanceM: null;
    };

export type PhysicalDiagnosticCallback = (
  solidId: string,
  pose: Pose,
  predictionM: number,
) => PhysicalDiagnostic;

export type PhysicalDiagnosticFactory = (
  solids: readonly ConvexPrism[],
  dimensions: Vector3,
) => Promise<PhysicalDiagnosticCallback>;
