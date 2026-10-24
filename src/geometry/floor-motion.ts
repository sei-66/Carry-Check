import {
  interpolatePose,
  halfExtents,
  normalizeQuaternion,
  rotationAngle,
  type Pose,
} from '../domain/pose';
import type { FloorRegion, PointXZ } from '../model/geometry-model';
import {
  floorViolations,
  footprintLocation,
  packedBottom,
  minimumPackedFloorHeight,
  type ModelQuery,
} from './model-query';
import {
  DEFAULT_VERIFICATION,
  verifyMotion,
  type VerificationOptions,
} from './verify-motion';

export interface FloorState {
  readonly pose: Pose;
  readonly floorRegionId: string;
}
export type ModelMotionVerification =
  | {
      readonly status: 'verified';
      readonly queries: number;
      readonly floorRegionIds: readonly string[];
    }
  | {
      readonly status: 'blocked';
      readonly queries: number;
      readonly constraintId: string | null;
      readonly physicalObstacleId: string | null;
    }
  | {
      readonly status: 'unverified';
      readonly queries: number;
      readonly reason: 'budget' | 'ambiguous-boundary' | 'query-failed';
    };

const EPS = 1e-10;
const cross = (a: PointXZ, b: PointXZ) => a.x * b.z - a.z * b.x;
const subtract = (a: PointXZ, b: PointXZ): PointXZ => ({
  x: a.x - b.x,
  z: a.z - b.z,
});

// Straight centre motion can cross every polygon edge analytically. All open
// intervals retain the explicit floor ID or cross a registered portal. Stacked
// floors can share XZ projections; proximity in XZ never selects another storey.
export function verifyModelMotion(
  query: ModelQuery,
  start: FloorState,
  end: FloorState,
  options: VerificationOptions = DEFAULT_VERIFICATION,
): ModelMotionVerification {
  if (
    !Number.isInteger(options.maxDepth) ||
    options.maxDepth < 0 ||
    options.maxDepth > 24 ||
    !Number.isInteger(options.maxQueries) ||
    options.maxQueries < 1 ||
    options.maxQueries > 100000
  )
    throw new Error('Invalid verification budget');
  let queries = 0;
  const blocked = (constraintId: string): ModelMotionVerification => ({
    status: 'blocked',
    queries,
    constraintId,
    physicalObstacleId: null,
  });
  const unknown = (
    reason: Extract<
      ModelMotionVerification,
      { status: 'unverified' }
    >['reason'],
  ): ModelMotionVerification => ({ status: 'unverified', queries, reason });
  try {
    start = {
      ...start,
      pose: {
        ...start.pose,
        rotation: normalizeQuaternion(start.pose.rotation),
      },
    };
    end = {
      ...end,
      pose: { ...end.pose, rotation: normalizeQuaternion(end.pose.rotation) },
    };
    const regions = query.model.floorRegions;
    const first = regions.find((r) => r.id === start.floorRegionId),
      last = regions.find((r) => r.id === end.floorRegionId);
    if (!first || !last) return unknown('query-failed');
    const invalidStart = floorViolations(
        first,
        start.pose,
        query.dimensions,
      )[0],
      invalidEnd = floorViolations(last, end.pose, query.dimensions)[0];
    if (invalidStart) return blocked(invalidStart);
    if (invalidEnd) return blocked(invalidEnd);
    // Endpoints on a shared edge must satisfy both floors even when no region
    // ID change occurs. An epsilon band outside an edge is never an extension.
    for (const state of [start, end]) {
      const region = regions.find((r) => r.id === state.floorRegionId);
      if (!region) return unknown('query-failed');
      if (
        footprintLocation(region.footprint, state.pose.position) !== 'boundary'
      )
        continue;
      const portals = query.model.portals.filter((portal) => {
        if (
          portal.fromRegionId !== region.id &&
          portal.toRegionId !== region.id
        )
          return false;
        const a = portal.edge[0],
          b = portal.edge[1],
          edge = subtract(b, a),
          point = subtract(state.pose.position, a);
        const t =
          (point.x * edge.x + point.z * edge.z) /
          (edge.x * edge.x + edge.z * edge.z);
        return cross(edge, point) === 0 && t >= 0 && t <= 1;
      });
      if (portals.length !== 1) return unknown('ambiguous-boundary');
      const portal = portals[0];
      if (!portal) return unknown('query-failed');
      for (const id of [portal.fromRegionId, portal.toRegionId]) {
        const other = regions.find((r) => r.id === id);
        if (!other) return unknown('query-failed');
        const violation = floorViolations(
          other,
          state.pose,
          query.dimensions,
        )[0];
        if (violation) return blocked(violation);
      }
    }
    const direction = subtract(end.pose.position, start.pose.position);
    const times = [0, 1];
    for (const region of regions) {
      for (let i = 0; i < region.footprint.length; i++) {
        let a = region.footprint[i],
          b = region.footprint[(i + 1) % region.footprint.length];
        if (!a || !b) return unknown('query-failed');
        // Canonical edge direction makes duplicates from shared floors exact.
        if (a.x > b.x || (a.x === b.x && a.z > b.z)) [a, b] = [b, a];
        const edge = subtract(b, a),
          offset = subtract(a, start.pose.position),
          denominator = cross(direction, edge);
        if (Math.abs(denominator) < 1e-15) continue;
        const t = cross(offset, edge) / denominator,
          u = cross(offset, direction) / denominator;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) times.push(t);
      }
    }
    times.sort((a, b) => a - b);
    if (
      times.some(
        (t, i) =>
          i > 0 &&
          t !== (times[i - 1] ?? t) &&
          Math.abs(t - (times[i - 1] ?? t)) <= EPS,
      )
    )
      return unknown('ambiguous-boundary');
    const unique = times.filter((t, i) => i === 0 || t !== times[i - 1]);
    const intervals: { a: number; b: number; region: FloorRegion }[] = [];
    let currentRegion = first;
    for (let i = 1; i < unique.length; i++) {
      const a = unique[i - 1],
        b = unique[i];
      if (a === undefined || b === undefined) return unknown('query-failed');
      const center = interpolatePose(
        start.pose,
        end.pose,
        (a + b) / 2,
      ).position;
      const inside = regions.filter(
        (r) => footprintLocation(r.footprint, center) === 'inside',
      );
      let region: FloorRegion | undefined;
      if (inside.some((r) => r.id === currentRegion.id)) region = currentRegion;
      else {
        const crossing = interpolatePose(start.pose, end.pose, a).position;
        const adjacent = inside.filter((r) =>
          query.model.portals.some((p) => {
            if (!(
              (p.fromRegionId === currentRegion.id && p.toRegionId === r.id) ||
              (p.toRegionId === currentRegion.id && p.fromRegionId === r.id)
            ))
              return false;
            const edge = subtract(p.edge[1], p.edge[0]),
              v = subtract(crossing, p.edge[0]);
            const along =
              (v.x * edge.x + v.z * edge.z) /
              (edge.x * edge.x + edge.z * edge.z);
            return (
              Math.abs(cross(edge, v)) / Math.hypot(edge.x, edge.z) <= EPS &&
              along >= 0 &&
              along <= 1
            );
          }),
        );
        if (adjacent.length > 1) return unknown('ambiguous-boundary');
        region = adjacent[0];
      }
      if (!region) {
        if (
          regions.some(
            (r) => footprintLocation(r.footprint, center) === 'boundary',
          )
        )
          return unknown('ambiguous-boundary');
        return blocked('constraint-floor-membership');
      }
      currentRegion = region;
      intervals.push({ a, b, region });
    }
    const visits = [
      { t: 0, region: first },
      ...intervals.map((interval) => ({
        t: interval.a,
        region: interval.region,
      })),
      { t: 1, region: last },
    ];
    for (let i = 1; i < visits.length; i++) {
      const before = visits[i - 1],
        after = visits[i];
      if (!before || !after) return unknown('query-failed');
      if (before.region.id === after.region.id) continue;
      const point = interpolatePose(start.pose, end.pose, after.t);
      const portal = query.model.portals.find(
        (p) =>
          (p.fromRegionId === before.region.id &&
            p.toRegionId === after.region.id) ||
          (p.toRegionId === before.region.id &&
            p.fromRegionId === after.region.id),
      );
      if (!portal) return blocked('constraint-nonadjacent-transition');
      const a = portal.edge[0],
        b = portal.edge[1],
        edge = subtract(b, a),
        v = subtract(point.position, a);
      const along =
        (v.x * edge.x + v.z * edge.z) / (edge.x * edge.x + edge.z * edge.z);
      if (
        Math.abs(cross(edge, v)) / Math.hypot(edge.x, edge.z) > EPS ||
        along < 0 ||
        along > 1
      )
        return unknown('ambiguous-boundary');
      for (const region of [before.region, after.region]) {
        const violation = floorViolations(region, point, query.dimensions)[0];
        if (violation) return blocked(violation);
      }
    }
    const lift = (
      region: FloorRegion,
      a: Pose,
      b: Pose,
      depth: number,
    ): ModelMotionVerification | null => {
      if (queries + 2 > options.maxQueries || options.shouldStop?.())
        return unknown('budget');
      queries += 2;
      const low = minimumPackedFloorHeight(region, query.dimensions),
        high = region.floorHeightM + region.maxLiftM;
      const bottomA = packedBottom(a, query.dimensions),
        bottomB = packedBottom(b, query.dimensions);
      if (Math.min(bottomA, bottomB) < low)
        return blocked(`constraint-below-${region.id}`);
      if (Math.max(bottomA, bottomB) > high)
        return blocked(`constraint-lift-${region.id}`);
      if (rotationAngle(a.rotation, b.rotation) === 0) return null; // affine bottom, endpoints suffice
      // The lifting reference depends only on centre Y and rotated vertical
      // support. Horizontal travel cannot change it. Bound that support over
      // the whole slerp from its midpoint instead of spending the full XYZ
      // travel length against a narrow vertical lifting interval.
      const middle = interpolatePose(a, b, 0.5);
      const halfHeight = halfExtents(
        query.dimensions.packed,
        middle.rotation,
      ).y;
      const angularSlack =
        2 *
        query.packed.radius *
        Math.sin(rotationAngle(a.rotation, b.rotation) / 4);
      const lowest =
        Math.min(a.position.y, b.position.y) - halfHeight - angularSlack;
      const highest =
        Math.max(a.position.y, b.position.y) -
        Math.max(0, halfHeight - angularSlack);
      if (lowest >= low && highest <= high) return null;
      if (depth >= options.maxDepth) return unknown('budget');
      return (
        lift(region, a, middle, depth + 1) ?? lift(region, middle, b, depth + 1)
      );
    };
    for (const interval of intervals) {
      const failure = lift(
        interval.region,
        interpolatePose(start.pose, end.pose, interval.a),
        interpolatePose(start.pose, end.pose, interval.b),
        0,
      );
      if (failure) return failure;
    }
    const remaining = options.maxQueries - queries;
    if (remaining < 2) return unknown('budget');
    const physical = verifyMotion(query.motionQuery, start.pose, end.pose, {
      ...options,
      maxQueries: remaining,
    });
    queries += physical.queries;
    if (physical.status === 'unverified') return unknown(physical.reason);
    if (physical.status === 'blocked')
      return {
        status: 'blocked',
        queries,
        constraintId:
          physical.obstacleId === query.model.outerConstraint.id
            ? physical.obstacleId
            : null,
        physicalObstacleId:
          physical.obstacleId === query.model.outerConstraint.id
            ? null
            : physical.obstacleId,
      };
    return {
      status: 'verified',
      queries,
      floorRegionIds: visits
        .map((v) => v.region.id)
        .filter((id, i, all) => i === 0 || id !== all[i - 1]),
    };
  } catch {
    return unknown('query-failed');
  }
}
