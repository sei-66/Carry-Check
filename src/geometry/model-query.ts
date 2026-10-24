import {
  millimetersToMeters,
  type ValidatedDimensions,
} from '../domain/dimensions';
import {
  halfExtents,
  interpolatePose,
  normalizeQuaternion,
  rotationAngle,
  type Pose,
} from '../domain/pose';
import {
  validateGeometryModel,
  type GeometryModel,
  type FloorRegion,
  type PointXZ,
} from '../model/geometry-model';
import { createPhysicalQuery, type PhysicalQuery } from './physical-query';
import {
  NUMERICAL_ERROR_M,
  type PhysicalDiagnosticFactory,
  type PoseQuery,
} from './query-types';

const POSITION_EPS_M = 1e-10;

// A boundary classification is not permission to inflate a floor polygon.
export function footprintLocation(
  points: readonly PointXZ[],
  point: PointXZ,
): 'inside' | 'boundary' | 'outside' {
  const a = points[0],
    b = points[1],
    c = points[2];
  if (!a || !b || !c) throw new Error('Invalid footprint');
  const orientation = Math.sign(
    (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x),
  );
  let boundary = false;
  for (let i = 0; i < points.length; i++) {
    const start = points[i],
      end = points[(i + 1) % points.length];
    if (!start || !end) throw new Error('Invalid footprint edge');
    const gap =
      (orientation *
        ((end.x - start.x) * (point.z - start.z) -
          (end.z - start.z) * (point.x - start.x))) /
      Math.hypot(end.x - start.x, end.z - start.z);
    if (gap < -POSITION_EPS_M) return 'outside';
    if (gap <= POSITION_EPS_M) boundary = true;
  }
  return boundary ? 'boundary' : 'inside';
}

export function packedBottom(
  pose: Pose,
  dimensions: ValidatedDimensions,
): number {
  return (
    pose.position.y -
    halfExtents(dimensions.packed, normalizeQuaternion(pose.rotation)).y
  );
}

export function floorViolations(
  region: FloorRegion,
  pose: Pose,
  dimensions: ValidatedDimensions,
): readonly string[] {
  const bottom = packedBottom(pose, dimensions);
  const violations: string[] = [];
  if (footprintLocation(region.footprint, pose.position) === 'outside')
    violations.push(`constraint-membership-${region.id}`);
  if (bottom < minimumPackedFloorHeight(region, dimensions))
    violations.push(`constraint-below-${region.id}`);
  if (bottom > region.floorHeightM + region.maxLiftM)
    violations.push(`constraint-lift-${region.id}`);
  return violations;
}

export function minimumPackedFloorHeight(
  region: FloorRegion,
  dimensions: ValidatedDimensions,
): number {
  return (
    region.floorHeightM + millimetersToMeters(dimensions.snapshot.marginMm)
  );
}

export interface ModelQuery {
  readonly model: GeometryModel;
  readonly dimensions: ValidatedDimensions;
  readonly packed: PhysicalQuery;
  readonly clearance: PhysicalQuery;
  // Collision/outer-space proof only. Floor transitions are verified separately.
  readonly motionQuery: PoseQuery;
  /** Collision certificates and virtual violations. Precise distances remain
   * available through packed.query / clearance.query. */
  query(
    pose: Pose,
    floorRegionId: string,
    predictionM: number,
  ): {
    readonly packed: ReturnType<PhysicalQuery['query']>;
    readonly clearance: ReturnType<PhysicalQuery['query']>;
    readonly virtualViolationIds: readonly string[];
  };
}

export interface ModelQueryOptions {
  readonly diagnosticFactory?: PhysicalDiagnosticFactory;
}

export async function createModelQuery(
  model: GeometryModel,
  dimensions: ValidatedDimensions,
  options: ModelQueryOptions = {},
): Promise<ModelQuery> {
  // Capture caller-owned data before asynchronous engine preparation.
  model = {
    ...model,
    physicalSolids: model.physicalSolids.map((solid) => ({
      ...solid,
      footprint: solid.footprint.map((p) => ({ ...p })),
    })),
    floorRegions: model.floorRegions.map((region) => ({
      ...region,
      footprint: region.footprint.map((p) => ({ ...p })),
    })),
    portals: model.portals.map((portal) => ({
      ...portal,
      edge: [{ ...portal.edge[0] }, { ...portal.edge[1] }],
    })),
    outerConstraint: {
      ...model.outerConstraint,
      bounds: {
        min: { ...model.outerConstraint.bounds.min },
        max: { ...model.outerConstraint.bounds.max },
      },
    },
  };
  dimensions = {
    ...dimensions,
    packed: { ...dimensions.packed },
    clearance: { ...dimensions.clearance },
    snapshot: { ...dimensions.snapshot },
  };
  validateGeometryModel(model);
  for (const axis of ['x', 'y', 'z'] as const) {
    if (dimensions.clearance[axis] < dimensions.packed[axis])
      throw new Error('Invalid clearance dimensions');
  }
  const [packed, clearance] = await Promise.all([
    createPhysicalQuery(model.physicalSolids, dimensions.packed, options),
    createPhysicalQuery(model.physicalSolids, dimensions.clearance, options),
  ]);
  const outerGap = (pose: Pose) => {
    const extent = halfExtents(
      dimensions.clearance,
      normalizeQuaternion(pose.rotation),
    );
    return Math.min(
      ...(['x', 'y', 'z'] as const).flatMap((axis) => [
        pose.position[axis] -
          extent[axis] -
          model.outerConstraint.bounds.min[axis],
        model.outerConstraint.bounds.max[axis] -
          pose.position[axis] -
          extent[axis],
      ]),
    );
  };
  return {
    model,
    dimensions,
    packed,
    clearance,
    motionQuery: {
      radius: clearance.radius,
      bounds: model.outerConstraint.bounds,
      sweepLowerBound(start, end) {
        if (!clearance.sweepLowerBound) return 0;
        const midpoint = interpolatePose(start, end, 0.5);
        const extent = halfExtents(dimensions.clearance, midpoint.rotation);
        // Every point rotates at most half the endpoint angle from midpoint.
        const angularEnvelope =
          2 *
          clearance.radius *
          Math.sin(rotationAngle(start.rotation, end.rotation) / 4);
        let outer = Infinity;
        for (const axis of ['x', 'y', 'z'] as const) {
          outer = Math.min(
            outer,
            Math.min(start.position[axis], end.position[axis]) -
              extent[axis] -
              angularEnvelope -
              model.outerConstraint.bounds.min[axis],
            model.outerConstraint.bounds.max[axis] -
              Math.max(start.position[axis], end.position[axis]) -
              extent[axis] -
              angularEnvelope,
          );
        }
        return Math.min(
          outer - NUMERICAL_ERROR_M,
          clearance.sweepLowerBound(start, end),
        );
      },
      query(pose, predictionM) {
        const physical =
          clearance.queryCollision?.(pose, predictionM) ??
          clearance.query(pose, predictionM);
        if (physical.status === 'unverified')
          throw new Error('Uncertain physical contact');
        const gap = outerGap(pose) - NUMERICAL_ERROR_M;
        const virtualIsCloser = gap < physical.lowerBoundM;
        return {
          status: physical.status === 'clear' && gap > 0 ? 'clear' : 'blocked',
          lowerBoundM: Math.min(gap, physical.lowerBoundM),
          upperBoundM:
            physical.upperBoundM === null
              ? null
              : Math.min(gap + 2 * NUMERICAL_ERROR_M, physical.upperBoundM),
          obstacleId: virtualIsCloser
            ? model.outerConstraint.id
            : (physical.intersectingSolidIds[0] ?? physical.limitingSolidId),
        };
      },
    },
    query(pose, floorRegionId, predictionM) {
      const region = model.floorRegions.find((r) => r.id === floorRegionId);
      if (!region) throw new Error('Unknown floor region');
      return {
        packed:
          packed.queryCollision?.(pose, predictionM) ??
          packed.query(pose, predictionM),
        clearance:
          clearance.queryCollision?.(pose, predictionM) ??
          clearance.query(pose, predictionM),
        virtualViolationIds: [
          ...floorViolations(region, pose, dimensions),
          ...(outerGap(pose) <= NUMERICAL_ERROR_M
            ? [model.outerConstraint.id]
            : []),
        ],
      };
    },
  };
}
