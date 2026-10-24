import {
  isPose,
  halfExtents,
  interpolatePose,
  normalizeQuaternion,
  rotationAngle,
  type Pose,
  type Vector3,
} from '../domain/pose';
import {
  prismVertices,
  validateConvexPrism,
  type ConvexPrism,
} from '../model/geometry-model';
import {
  NUMERICAL_ERROR_M,
  type PhysicalDiagnostic,
  type PhysicalDiagnosticFactory,
} from './query-types';
import { validDimensions, type Bounds } from './scene';
import { prismDistanceBounds, prismSeparation } from './prism-separation';
import { prismMotionLowerBound } from './prism-motion-distance';

export interface PhysicalClearance {
  readonly status: 'clear' | 'blocked' | 'unverified';
  readonly lowerBoundM: number;
  readonly upperBoundM: number | null;
  // null when independent intervals cannot certify which solid is nearest.
  readonly obstacleId: string | null;
  readonly limitingSolidId: string;
  readonly intersectingSolidIds: readonly string[];
  // Empty when diagnosticsEnabled is false. Diagnostic values never prove safety.
  readonly diagnosticsEnabled: boolean;
  readonly unmeasuredSolidIds: readonly string[];
  readonly rapierRangeMismatchIds: readonly string[];
  readonly rapierDistanceMismatchIds: readonly string[];
  readonly rapierUnavailableSolidIds: readonly string[];
  readonly rapierQueryFailureIds: readonly string[];
}

export interface PhysicalQuery {
  readonly radius: number;
  query(pose: Pose, predictionM: number): PhysicalClearance;
  /** Collision proof only; does not identify or measure the nearest solid. */
  queryCollision?(pose: Pose, predictionM?: number): PhysicalClearance;
  sweepLowerBound?(start: Pose, end: Pose): number;
}

// Uses the shared numerical error budget, validated for
// M1 fixtures only; it is not survey accuracy or a guarantee for arbitrary hulls.
const outward = (value: number) =>
  Math.abs(value) * Number.EPSILON + Number.MIN_VALUE;

// Axis-aligned enclosures supply a conservative separating plane. Overlap is
// never classified as intersection; it falls through to the convex calculation.
function enclosureGap(a: Bounds, b: Bounds): number {
  return Math.max(
    a.min.x - b.max.x,
    b.min.x - a.max.x,
    a.min.y - b.max.y,
    b.min.y - a.max.y,
    a.min.z - b.max.z,
    b.min.z - a.max.z,
  );
}

export interface PhysicalQueryOptions {
  readonly diagnosticFactory?: PhysicalDiagnosticFactory;
}

export async function createPhysicalQuery(
  solids: readonly ConvexPrism[],
  dimensions: Vector3,
  options: PhysicalQueryOptions = {},
): Promise<PhysicalQuery> {
  if (
    !validDimensions(dimensions) ||
    solids.length === 0 ||
    solids.length > 1000
  )
    throw new Error('Invalid physical query');
  dimensions = { ...dimensions };
  solids = solids.map((solid) => ({
    ...solid,
    footprint: solid.footprint.map((point) => ({ ...point })),
  }));
  const ids = new Set<string>();
  for (const solid of solids) {
    validateConvexPrism(solid);
    if (
      prismVertices(solid).some((v) =>
        [v.x, v.y, v.z].some((n) => Math.abs(n) > 20),
      )
    )
      throw new Error('Physical geometry outside supported coordinates');
    if (ids.has(solid.id)) throw new Error('Duplicate physical ID');
    ids.add(solid.id);
  }
  const shapes = solids.map((solid) => {
    const vertices = prismVertices(solid);
    return {
      id: solid.id,
      vertices,
      footprint: solid.footprint,
      bounds: {
        min: {
          x: Math.min(...vertices.map((v) => v.x)),
          y: solid.bottomM,
          z: Math.min(...vertices.map((v) => v.z)),
        },
        max: {
          x: Math.max(...vertices.map((v) => v.x)),
          y: solid.topM,
          z: Math.max(...vertices.map((v) => v.z)),
        },
      },
    };
  });
  const diagnostic = options.diagnosticFactory
    ? await options.diagnosticFactory(solids, dimensions)
    : undefined;
  const checkedPose = (pose: Pose): Pose => {
    if (
      !isPose(pose) ||
      [pose.position.x, pose.position.y, pose.position.z].some(
        (n) => Math.abs(n) > 20,
      )
    )
      throw new Error('Invalid physical distance query');
    return { ...pose, rotation: normalizeQuaternion(pose.rotation) };
  };
  const result: PhysicalQuery = {
    radius: Math.hypot(dimensions.x, dimensions.y, dimensions.z) / 2,
    queryCollision(pose, predictionM = 0) {
      if (!Number.isFinite(predictionM) || predictionM < 0 || predictionM > 100)
        throw new Error('Invalid physical distance query');
      // Keep optional M1 diagnostic observation behavior on its precise path.
      if (diagnostic) return result.query(pose, predictionM);
      pose = checkedPose(pose);
      const extent = halfExtents(dimensions, pose.rotation);
      const bounds = {
        min: {
          x: pose.position.x - extent.x,
          y: pose.position.y - extent.y,
          z: pose.position.z - extent.z,
        },
        max: {
          x: pose.position.x + extent.x,
          y: pose.position.y + extent.y,
          z: pose.position.z + extent.z,
        },
      };
      let lower = Infinity;
      let limitingSolidId = shapes[0]!.id;
      const intersectingSolidIds: string[] = [];
      for (const solid of shapes) {
        const broadGap = enclosureGap(bounds, solid.bounds);
        const separation =
          broadGap > NUMERICAL_ERROR_M + 1e-10
            ? { lowerBoundM: broadGap, complete: true }
            : prismSeparation(
                solid.vertices,
                solid.footprint,
                dimensions,
                pose,
              );
        const bounded = separation.lowerBoundM;
        const lo = bounded - NUMERICAL_ERROR_M - outward(bounded);
        if (!Number.isFinite(lo)) throw new Error('Invalid separation bound');
        if (lo < lower) {
          lower = lo;
          limitingSolidId = solid.id;
        }
        if (separation.complete && bounded < -NUMERICAL_ERROR_M)
          intersectingSolidIds.push(solid.id);
      }
      // A wider separating interval can be uncertain near a diagonal feature;
      // use the existing witnesses there, rather than rejecting a clear pose.
      if (lower <= 0 && intersectingSolidIds.length === 0)
        return result.query(pose, 0);
      return {
        status: intersectingSolidIds.length > 0 ? 'blocked' : 'clear',
        lowerBoundM: lower,
        upperBoundM: null,
        obstacleId: null,
        limitingSolidId,
        intersectingSolidIds,
        diagnosticsEnabled: false,
        unmeasuredSolidIds: [],
        rapierRangeMismatchIds: [],
        rapierDistanceMismatchIds: [],
        rapierUnavailableSolidIds: [],
        rapierQueryFailureIds: [],
      };
    },
    sweepLowerBound(start, end) {
      if (
        !isPose(start) ||
        !isPose(end) ||
        [start.position, end.position].some((p) =>
          [p.x, p.y, p.z].some((n) => Math.abs(n) > 20),
        )
      )
        throw new Error('Invalid physical sweep');
      const midpoint = interpolatePose(start, end, 0.5);
      const extent = halfExtents(dimensions, midpoint.rotation);
      const envelope =
        2 *
        result.radius *
        Math.sin(rotationAngle(start.rotation, end.rotation) / 4);
      const sweptBounds = {
        min: {
          x: Math.min(start.position.x, end.position.x) - extent.x - envelope,
          y: Math.min(start.position.y, end.position.y) - extent.y - envelope,
          z: Math.min(start.position.z, end.position.z) - extent.z - envelope,
        },
        max: {
          x: Math.max(start.position.x, end.position.x) + extent.x + envelope,
          y: Math.max(start.position.y, end.position.y) + extent.y + envelope,
          z: Math.max(start.position.z, end.position.z) + extent.z + envelope,
        },
      };
      const lower = Math.min(
        ...shapes.map((solid) => {
          const broadGap = enclosureGap(sweptBounds, solid.bounds);
          return broadGap > NUMERICAL_ERROR_M + 1e-10
            ? broadGap
            : prismMotionLowerBound(
                solid.vertices,
                solid.footprint,
                dimensions,
                start,
                end,
              );
        }),
      );
      return Math.max(0, lower - NUMERICAL_ERROR_M - outward(lower));
    },
    query(pose, predictionM) {
      if (!Number.isFinite(predictionM) || predictionM < 0 || predictionM > 100)
        throw new Error('Invalid physical distance query');
      pose = checkedPose(pose);
      let lower = Infinity;
      let upper = Infinity;
      let closest: string | null = null;
      let limitingSolidId = shapes[0]?.id ?? '';
      const solidBounds: { id: string; lower: number }[] = [];
      const unmeasuredSolidIds: string[] = [];
      const rapierRangeMismatchIds: string[] = [];
      const rapierDistanceMismatchIds: string[] = [];
      const rapierUnavailableSolidIds: string[] = [];
      const rapierQueryFailureIds: string[] = [];
      const intersectingSolidIds: string[] = [];
      for (const solid of shapes) {
        let measured: PhysicalDiagnostic | undefined;
        if (diagnostic) {
          try {
            measured = diagnostic(solid.id, pose, predictionM);
          } catch {
            // Optional diagnostics cannot invalidate the independent f64 query.
            measured = { kind: 'query-failed', distanceM: null };
          }
        }
        const distance = measured?.distanceM ?? null;
        // Convex contactShape can return null even inside prediction range.
        // A null is therefore NEVER used as a prediction-distance safety proof.
        const bounds = prismDistanceBounds(
          solid.vertices,
          solid.footprint,
          dimensions,
          pose,
        );
        const { separation } = bounds;
        if (separation.complete && separation.lowerBoundM < -NUMERICAL_ERROR_M)
          intersectingSolidIds.push(solid.id);
        const bounded = bounds.lowerBoundM;
        const lo = bounded - NUMERICAL_ERROR_M - outward(bounded);
        if (lo < lower) {
          lower = lo;
          limitingSolidId = solid.id;
        }
        solidBounds.push({ id: solid.id, lower: lo });
        const candidateUpper = bounds.upperBoundM;
        const hi = candidateUpper + NUMERICAL_ERROR_M + outward(candidateUpper);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi)
          throw new Error('Inconsistent physical distance interval');
        if (
          measured &&
          distance !== null &&
          separation.lowerBoundM >= 0 &&
          (distance < lo || distance > hi)
        )
          rapierDistanceMismatchIds.push(solid.id);
        if (measured && distance === null) {
          unmeasuredSolidIds.push(solid.id);
          if (measured.kind === 'out-of-range' && hi < predictionM)
            rapierRangeMismatchIds.push(solid.id);
          if (measured.kind === 'shape-unavailable')
            rapierUnavailableSolidIds.push(solid.id);
          if (measured.kind === 'query-failed')
            rapierQueryFailureIds.push(solid.id);
        }
        if (hi < upper) {
          upper = hi;
          closest = solid.id;
        }
      }
      return {
        status:
          lower > 0
            ? 'clear'
            : intersectingSolidIds.length > 0
              ? 'blocked'
              : 'unverified',
        lowerBoundM: lower,
        upperBoundM: Number.isFinite(upper) ? upper : null,
        obstacleId: solidBounds.every(
          (bound) => bound.id === closest || upper < bound.lower,
        )
          ? closest
          : null,
        limitingSolidId,
        intersectingSolidIds,
        diagnosticsEnabled: diagnostic !== undefined,
        unmeasuredSolidIds,
        rapierRangeMismatchIds,
        rapierDistanceMismatchIds,
        rapierUnavailableSolidIds,
        rapierQueryFailureIds,
      };
    },
  };
  return result;
}
