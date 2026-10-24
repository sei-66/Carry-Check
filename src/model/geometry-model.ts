import { isVector3, type Vector3 } from '../domain/pose';
import type { Bounds } from '../geometry/scene';

export interface PointXZ {
  readonly x: number;
  readonly z: number;
}

/** Closed physical solid, in world coordinates and metres. */
export interface ConvexPrism {
  readonly id: string;
  readonly footprint: readonly PointXZ[];
  readonly bottomM: number;
  readonly topM: number;
}

/** Centre projection membership and packed-box lifting reference. */
interface FloorRegionBase {
  readonly id: string;
  readonly footprint: readonly PointXZ[];
  readonly floorHeightM: number;
  readonly maxLiftM: number;
}

export type FloorRegion = FloorRegionBase &
  (
    | { readonly physicalSolidId: string; readonly basis?: 'physical' }
    | { readonly physicalSolidId: null; readonly basis: 'terminal-reference' }
  );

/** One stored adjacency across an exact, zero-width edge; local backtracking is allowed. */
export interface FloorPortal {
  readonly id: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly edge: readonly [PointXZ, PointXZ];
}

/** Artificial full-box containment constraint; never a physical obstacle. */
export interface OuterConstraint {
  readonly id: string;
  readonly bounds: Bounds;
}

export interface GeometryModel {
  readonly id: string;
  readonly physicalSolids: readonly ConvexPrism[];
  readonly floorRegions: readonly FloorRegion[];
  readonly portals: readonly FloorPortal[];
  readonly outerConstraint: OuterConstraint;
}

// Degeneracy thresholds for the model contract, not collision tolerances or
// evidence about the accuracy of any surveyed housing dimensions.
const MIN_EDGE_M = 1e-9;
const MIN_CROSS_M2 = 1e-12;

function cross(a: PointXZ, b: PointXZ, c: PointXZ): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function samePoint(a: PointXZ, b: PointXZ): boolean {
  return a.x === b.x && a.z === b.z;
}

/** Rejects duplicate/collinear vertices, concavity and self-intersection. */
export function validateConvexFootprint(points: readonly PointXZ[]): void {
  if (
    points.length < 3 ||
    points.length > 32 ||
    !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))
  )
    throw new Error('Invalid convex footprint');

  let orientation = 0;
  for (const [index, a] of points.entries()) {
    const b = points[(index + 1) % points.length];
    if (!b || Math.hypot(b.x - a.x, b.z - a.z) <= MIN_EDGE_M)
      throw new Error('Degenerate footprint edge');
    for (const [otherIndex, point] of points.entries()) {
      if (otherIndex === index || otherIndex === (index + 1) % points.length)
        continue;
      const side = cross(a, b, point);
      if (!Number.isFinite(side) || Math.abs(side) <= MIN_CROSS_M2)
        throw new Error('Degenerate convex footprint');
      orientation ||= Math.sign(side);
      if (Math.sign(side) !== orientation)
        throw new Error('Footprint is not strictly convex');
    }
  }
}

export function validateConvexPrism(prism: ConvexPrism): void {
  if (
    !prism.id ||
    !Number.isFinite(prism.bottomM) ||
    !Number.isFinite(prism.topM) ||
    !Number.isFinite(prism.topM - prism.bottomM) ||
    prism.topM <= prism.bottomM
  )
    throw new Error('Invalid convex prism');
  validateConvexFootprint(prism.footprint);
}

/** Bottom ring then top ring, preserving the footprint order. */
export function prismVertices(prism: ConvexPrism): readonly Vector3[] {
  validateConvexPrism(prism);
  return [prism.bottomM, prism.topM].flatMap((y) =>
    prism.footprint.map(({ x, z }) => ({ x, y, z })),
  );
}

function hasEdge(
  footprint: readonly PointXZ[],
  [start, end]: readonly [PointXZ, PointXZ],
): boolean {
  return footprint.some((a, index) => {
    const b = footprint[(index + 1) % footprint.length];
    return (
      !!b &&
      ((samePoint(a, start) && samePoint(b, end)) ||
        (samePoint(a, end) && samePoint(b, start)))
    );
  });
}

function sameFootprint(a: readonly PointXZ[], b: readonly PointXZ[]): boolean {
  return (
    a.length === b.length &&
    a.every((point) => b.some((other) => samePoint(point, other)))
  );
}

export function validateGeometryModel(model: GeometryModel): void {
  if (!model.id) throw new Error('Invalid model ID');
  const { min, max } = model.outerConstraint.bounds;
  if (
    !isVector3(min) ||
    !isVector3(max) ||
    !(['x', 'y', 'z'] as const).every((axis) => min[axis] < max[axis])
  )
    throw new Error('Invalid outer constraint');

  const ids = new Set<string>();
  const registerId = (id: string) => {
    if (!id || ids.has(id)) throw new Error('Invalid or duplicate element ID');
    ids.add(id);
  };
  registerId(model.outerConstraint.id);
  const solids = new Map<string, ConvexPrism>();
  for (const solid of model.physicalSolids) {
    registerId(solid.id);
    validateConvexPrism(solid);
    solids.set(solid.id, solid);
  }

  const regions = new Map<string, FloorRegion>();
  for (const region of model.floorRegions) {
    registerId(region.id);
    validateConvexFootprint(region.footprint);
    if (
      !Number.isFinite(region.floorHeightM) ||
      !Number.isFinite(region.maxLiftM) ||
      region.maxLiftM < 0
    )
      throw new Error('Invalid floor reference');
    if (region.physicalSolidId === null) {
      if (region.basis !== 'terminal-reference')
        throw new Error('Invalid virtual floor reference');
    } else {
      const solid = solids.get(region.physicalSolidId);
      if (
        !solid ||
        region.floorHeightM !== solid.topM ||
        !sameFootprint(region.footprint, solid.footprint)
      )
        throw new Error('Invalid physical floor region');
    }
    regions.set(region.id, region);
  }

  const transitions = new Set<string>();
  for (const portal of model.portals) {
    registerId(portal.id);
    const from = regions.get(portal.fromRegionId);
    const to = regions.get(portal.toRegionId);
    const transition = JSON.stringify([portal.fromRegionId, portal.toRegionId]);
    if (
      !from ||
      !to ||
      from === to ||
      transitions.has(transition) ||
      !hasEdge(from.footprint, portal.edge) ||
      !hasEdge(to.footprint, portal.edge)
    )
      throw new Error('Invalid shared-edge portal');
    transitions.add(transition);
  }
}
