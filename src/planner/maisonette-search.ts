import {
  halfExtents,
  rotationAngle,
  type Pose,
  type Quaternion,
  type Vector3,
} from '../domain/pose';
import type { CalculationOptions } from '../shared/calculation-messages';
import { NUMERICAL_ERROR_M } from '../geometry/query-types';
import { verifyModelMotion, type FloorState } from '../geometry/floor-motion';
import {
  entryStartCenterPlaneDot,
  entryStartCenterPosition,
} from '../model/entry-start';
import { footprintLocation, type ModelQuery } from '../geometry/model-query';
import type { PointXZ } from '../model/geometry-model';
import type {
  HousingOpening,
  MaisonetteModel,
  RouteGuidePoint,
  RouteStage,
} from '../model/maisonette-model';
import { searchLocalMaisonetteManeuver } from './local-maisonette-maneuver';
import { seededRandom } from './rrt-connect';

export const MAX_MAISONETTE_QUERIES = 50_000;

const MAX_SEARCH_NODES = 20_000;
const MAX_SEARCH_TIME_MS = 30_000;
const POINT_PREDICTION_M = NUMERICAL_ERROR_M * 2;
const BASE_LIFT_M = 0.38;
const HIGH_LIFT_M = 0.62;
const MAX_PARENT_ATTEMPTS = 8;
const MAX_LAYER_CANDIDATES = 96;
const MAX_REFERENCE_POSITION_CANDIDATES = 32;
const MAX_HYBRID_ROTATION_PAIRS = 2;
const MAX_REACHABLE_PER_LAYER = 42;
// Preserve vertical alternatives for a rotation: a low pose may fit the LDK
// header while a higher pose is needed on the staircase.
const MAX_CONNECTED_PER_ORIENTATION = 3;
// Compound 45 degree yaw/pitch/roll samples are linked to their single-axis
// neighbors by turns shorter than this cap. Every such turn is still swept by
// verifyModelMotion before it can enter the graph.
const MAX_ROTATION_STEP_RAD = (85 * Math.PI) / 180;
const EDGE_MAX_DEPTH = 18;
const FINAL_EDGE_MAX_DEPTH = 18;
const POSITION_CANDIDATE_PAD_M = NUMERICAL_ERROR_M * 4;

export type MaisonetteSearchFailureReason =
  | 'node-limit'
  | 'time-limit'
  | 'no-path'
  | 'start-invalid'
  | 'goal-invalid'
  | 'verification-limit';

export type MaisonetteSearchResult =
  | {
      readonly status: 'path-found';
      readonly poses: readonly Pose[];
      readonly floorRegionIds: readonly string[];
      readonly seed: number;
      readonly nodesVisited: number;
      readonly elapsedMs: number;
      readonly queries: number;
    }
  | {
      readonly status: 'path-not-found';
      readonly reason: MaisonetteSearchFailureReason;
      readonly seed: number;
      readonly nodesVisited: number;
      readonly elapsedMs: number;
      readonly queries: number;
    };

export type MaisonetteProgress = (
  nodesVisited: number,
  elapsedMs: number,
  stage: 'searching' | 'verifying',
) => void;

export interface MaisonetteEdgeDiagnostic {
  readonly kind: 'edge';
  readonly phase:
    'reference' | 'reference-final' | 'layer-connect' | 'final-route';
  readonly layerIndex: number | null;
  readonly fromFloorRegionId: string;
  readonly toFloorRegionId: string;
  readonly maxDepth: number;
  readonly queryBudget: number;
  readonly queriesUsed: number;
  readonly totalQueriesBefore: number;
  readonly totalQueriesAfter: number;
  readonly status:
    | 'verified'
    | 'blocked'
    | 'unverified'
    | 'time-limit'
    | 'verification-limit'
    | 'node-limit';
  readonly detail: string | null;
}

export interface MaisonetteLayerDiagnostic {
  readonly kind: 'layer';
  readonly phase: 'candidates' | 'connections';
  readonly layerIndex: number;
  readonly fromFloorRegionIds: readonly string[];
  readonly toFloorRegionIds: readonly string[];
  readonly fromCandidates: number;
  readonly toCandidates: number;
  readonly reachableCandidates: number;
  readonly connectedCandidates: number;
  readonly edgeAttempts: number;
  readonly verifiedEdges: number;
  readonly blockedEdges: number;
  readonly unverifiedEdges: number;
  readonly queriesUsed: number;
  readonly stopReason: MaisonetteSearchFailureReason | null;
}

export interface MaisonetteCandidateDiagnostic {
  readonly kind: 'candidate';
  readonly phase:
    'reference' | 'start' | 'route-layer' | 'terminal-approach' | 'goal';
  readonly layerIndex: number | null;
  readonly floorRegionId: string;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  readonly status: 'valid' | 'blocked' | 'unverified' | 'stopped';
  readonly detail: string | null;
}

export type MaisonetteSearchDiagnostic =
  | MaisonetteEdgeDiagnostic
  | MaisonetteLayerDiagnostic
  | MaisonetteCandidateDiagnostic;
export type MaisonetteDiagnostics = (
  diagnostic: MaisonetteSearchDiagnostic,
) => void;

interface SearchNode {
  readonly state: FloorState;
  parentIndex: number | undefined;
  lockedParentIndex: number | undefined;
}

type CheckResult =
  'verified' | 'blocked' | 'unverified' | MaisonetteSearchFailureReason;

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function axisRotation(axis: 'x' | 'y' | 'z', angle: number): Quaternion {
  const sine = Math.sin(angle / 2);
  const cosine = Math.cos(angle / 2);
  if (axis === 'x') return { x: sine, y: 0, z: 0, w: cosine };
  if (axis === 'y') return { x: 0, y: sine, z: 0, w: cosine };
  return { x: 0, y: 0, z: sine, w: cosine };
}

function eulerRotation(yaw: number, pitch: number, roll: number): Quaternion {
  return multiply(
    axisRotation('y', yaw),
    multiply(axisRotation('x', pitch), axisRotation('z', roll)),
  );
}

export function maisonetteOrientationCandidates(
  seed: number,
): readonly Quaternion[] {
  const candidates: Quaternion[] = [{ x: 0, y: 0, z: 0, w: 1 }];
  const degrees = [45, -45, 90, -90, 135, -135, 180];
  const radians = (value: number) => (value * Math.PI) / 180;
  const add = (q: Quaternion) => {
    if (candidates.some((existing) => rotationAngle(existing, q) < 1e-8))
      return;
    candidates.push(q);
  };

  // The fixed lattice includes yaw, pitch and roll. Compound candidates let
  // the planner test simultaneous tilt/yaw without requiring a full SO(3) grid.
  for (const angle of degrees)
    for (const axis of ['y', 'x', 'z'] as const)
      add(axisRotation(axis, radians(angle)));

  // Include all 24 proper rotations of the item's principal axes. Single-axis
  // turns cover only part of these permutations; a narrow opening can require
  // a compound quarter turn even when no arbitrary-angle tilt is needed.
  const cubeRotations: Quaternion[] = [candidates[0]!];
  const quarterTurns = (['x', 'y', 'z'] as const).map((axis) =>
    axisRotation(axis, Math.PI / 2),
  );
  for (let cursor = 0; cursor < cubeRotations.length; cursor++) {
    const current = cubeRotations[cursor];
    if (!current) continue;
    for (const turn of quarterTurns) {
      const candidate = multiply(current, turn);
      if (
        !cubeRotations.some(
          (existing) => rotationAngle(existing, candidate) < 1e-8,
        )
      )
        cubeRotations.push(candidate);
    }
  }
  for (const rotation of cubeRotations) add(rotation);

  for (const yaw of [-45, 45])
    for (const pitch of [-45, 45])
      add(eulerRotation(radians(yaw), radians(pitch), 0));
  for (const yaw of [-45, 45])
    for (const roll of [-45, 45])
      add(eulerRotation(radians(yaw), 0, radians(roll)));
  for (const pitch of [-45, 45])
    for (const roll of [-45, 45])
      add(eulerRotation(0, radians(pitch), radians(roll)));
  for (const yaw of [-45, 45])
    for (const pitch of [-45, 45])
      for (const roll of [-45, 45])
        add(eulerRotation(radians(yaw), radians(pitch), radians(roll)));

  // Small seeded compound rotations add reproducible six-degree samples while
  // remaining connected to the fixed lattice by short interpolated turns.
  const random = seededRandom(seed);
  for (let index = 0; index < 4; index++) {
    const angle = () => (random() * 40 - 20) * (Math.PI / 180);
    add(eulerRotation(angle(), angle(), angle()));
  }
  return candidates;
}

function polygonCentroid(points: readonly PointXZ[]): PointXZ {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function sampleConvexFootprint(
  points: readonly PointXZ[],
  random: () => number,
): PointXZ {
  const first = points[0];
  if (!first || points.length < 3) throw new Error('Invalid floor footprint');
  const triangles = [] as {
    readonly a: PointXZ;
    readonly b: PointXZ;
    readonly c: PointXZ;
    readonly area: number;
  }[];
  let totalArea = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const b = points[index];
    const c = points[index + 1];
    if (!b || !c) continue;
    const area = Math.abs(
      (b.x - first.x) * (c.z - first.z) - (b.z - first.z) * (c.x - first.x),
    );
    if (area <= 0) continue;
    triangles.push({ a: first, b, c, area });
    totalArea += area;
  }
  let choice = random() * totalArea;
  let triangle = triangles[triangles.length - 1];
  for (const candidate of triangles) {
    choice -= candidate.area;
    if (choice <= 0) {
      triangle = candidate;
      break;
    }
  }
  if (!triangle) return polygonCentroid(points);
  const root = Math.sqrt(random());
  const second = random();
  return {
    x:
      (1 - root) * triangle.a.x +
      root * (1 - second) * triangle.b.x +
      root * second * triangle.c.x,
    z:
      (1 - root) * triangle.a.z +
      root * (1 - second) * triangle.b.z +
      root * second * triangle.c.z,
  };
}

function uniquePositions(points: readonly PointXZ[]): PointXZ[] {
  const unique: PointXZ[] = [];
  for (const point of points)
    if (
      !unique.some(
        (existing) =>
          Math.hypot(existing.x - point.x, existing.z - point.z) < 1e-8,
      )
    )
      unique.push(point);
  return unique;
}

function footprintBounds(points: readonly PointXZ[]) {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z),
      maxZ: Math.max(bounds.maxZ, point.z),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    },
  );
}

/**
 * Keep the guide point first, then move along one horizontal axis to a nearby
 * physical-solid boundary. Bounds only suggest candidates; the normal model
 * query still has to prove each pose clear.
 */
function obstacleBoundaryPositions(
  query: ModelQuery,
  guide: RouteGuidePoint,
  rotation: Quaternion,
  liftM: number,
): PointXZ[] {
  const region = query.model.floorRegions.find(
    (candidate) => candidate.id === guide.floorRegionId,
  );
  if (!region) return [];
  const clearanceHalf = halfExtents(query.dimensions.clearance, rotation);
  const packedHalf = halfExtents(query.dimensions.packed, rotation);
  const centerY = guide.floorHeightM + liftM + packedHalf.y;
  const itemBottom = centerY - clearanceHalf.y;
  const itemTop = centerY + clearanceHalf.y;
  const origin = guide.positionXZ;
  const xCoordinates = [origin.x];
  const zCoordinates = [origin.z];
  const relevantBounds: ReturnType<typeof footprintBounds>[] = [];

  for (const solid of query.model.physicalSolids) {
    if (
      itemBottom >= solid.topM + POSITION_CANDIDATE_PAD_M ||
      itemTop <= solid.bottomM - POSITION_CANDIDATE_PAD_M
    )
      continue;
    const bounds = footprintBounds(solid.footprint);
    relevantBounds.push(bounds);
    const minX = bounds.minX - clearanceHalf.x - POSITION_CANDIDATE_PAD_M;
    const maxX = bounds.maxX + clearanceHalf.x + POSITION_CANDIDATE_PAD_M;
    const minZ = bounds.minZ - clearanceHalf.z - POSITION_CANDIDATE_PAD_M;
    const maxZ = bounds.maxZ + clearanceHalf.z + POSITION_CANDIDATE_PAD_M;
    if (
      origin.x + clearanceHalf.x < bounds.minX - POSITION_CANDIDATE_PAD_M ||
      origin.x - clearanceHalf.x > bounds.maxX + POSITION_CANDIDATE_PAD_M ||
      origin.z + clearanceHalf.z < bounds.minZ - POSITION_CANDIDATE_PAD_M ||
      origin.z - clearanceHalf.z > bounds.maxZ + POSITION_CANDIDATE_PAD_M
    )
      continue;

    xCoordinates.push(minX, maxX);
    zCoordinates.push(minZ, maxZ);
  }

  const positions = uniquePositions(
    uniqueNumbers(xCoordinates).flatMap((x) =>
      uniqueNumbers(zCoordinates).map((z) => ({ x, z })),
    ),
  );
  const inside = uniquePositions(positions).filter(
    (point) => footprintLocation(region.footprint, point) === 'inside',
  );
  const originCandidate = inside.find(
    (point) => Math.hypot(point.x - origin.x, point.z - origin.z) < 1e-8,
  );
  const adjusted = inside
    .filter(
      (point) => Math.hypot(point.x - origin.x, point.z - origin.z) >= 1e-8,
    )
    .map((point, index) => ({
      point,
      index,
      distance: Math.hypot(point.x - origin.x, point.z - origin.z),
      overlaps: relevantBounds.reduce(
        (count, bounds) =>
          count +
          (point.x + clearanceHalf.x >= bounds.minX &&
          point.x - clearanceHalf.x <= bounds.maxX &&
          point.z + clearanceHalf.z >= bounds.minZ &&
          point.z - clearanceHalf.z <= bounds.maxZ
            ? 1
            : 0),
        0,
      ),
    }))
    .sort(
      (a, b) =>
        a.overlaps - b.overlaps || a.distance - b.distance || a.index - b.index,
    )
    .slice(0, MAX_REFERENCE_POSITION_CANDIDATES - (originCandidate ? 1 : 0))
    .map(({ point }) => point);
  return originCandidate ? [originCandidate, ...adjusted] : adjusted;
}

export function maisonetteOpeningTransverseCandidates(
  opening: HousingOpening,
  rotation: Quaternion,
  clearanceDimensions: Vector3,
): number[] {
  const half = halfExtents(clearanceDimensions, rotation);
  const extent = extentAlongWidth(opening, half);
  const low = opening.transverseMinM + extent;
  const high = opening.transverseMaxM - extent;
  const available = high - low;
  if (available < 2 * NUMERICAL_ERROR_M) return [];

  const candidates = [(low + high) / 2];
  // Epsilon is for the opening plane. Only use lateral edge samples when they
  // can retain that margin; a tight but query-verifiable centre remains useful.
  if (available >= 2 * (opening.epsilonM + NUMERICAL_ERROR_M))
    candidates.push(
      low + opening.epsilonM + NUMERICAL_ERROR_M,
      high - opening.epsilonM - NUMERICAL_ERROR_M,
    );
  return uniqueNumbers(candidates);
}

function openingPosition(
  opening: HousingOpening,
  planeDot: number,
  transverse: number,
  y: number,
): { x: number; y: number; z: number } {
  const normal = opening.normal;
  if (opening.widthAxis === 'x') {
    if (Math.abs(normal.z) < 1e-12) throw new Error('Invalid opening normal');
    return {
      x: transverse,
      y,
      z: (planeDot - normal.x * transverse - normal.y * y) / normal.z,
    };
  }
  if (Math.abs(normal.x) < 1e-12) throw new Error('Invalid opening normal');
  return {
    x: (planeDot - normal.y * y - normal.z * transverse) / normal.x,
    y,
    z: transverse,
  };
}

function extentAlongNormal(
  opening: HousingOpening,
  half: { readonly x: number; readonly y: number; readonly z: number },
): number {
  const normal = opening.normal;
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(length) || length < 1e-12)
    throw new Error('Invalid opening normal');
  return (
    (Math.abs(normal.x) * half.x +
      Math.abs(normal.y) * half.y +
      Math.abs(normal.z) * half.z) /
    length
  );
}

function extentAlongWidth(
  opening: HousingOpening,
  half: { readonly x: number; readonly z: number },
): number {
  return opening.widthAxis === 'x' ? half.x : half.z;
}

function transverseCoordinate(opening: HousingOpening, point: PointXZ): number {
  return opening.widthAxis === 'x' ? point.x : point.z;
}

function clearanceInsideStartBounds(
  center: { readonly x: number; readonly z: number },
  halfExtentsXZ: { readonly x: number; readonly z: number },
  bounds: MaisonetteModel['startBounds'],
): boolean {
  return (
    center.x - halfExtentsXZ.x >= bounds.min.x &&
    center.x + halfExtentsXZ.x <= bounds.max.x &&
    center.z - halfExtentsXZ.z >= bounds.min.z &&
    center.z + halfExtentsXZ.z <= bounds.max.z
  );
}

export function searchMaisonette(
  query: ModelQuery,
  house: MaisonetteModel,
  options: CalculationOptions,
  onProgress: MaisonetteProgress = () => {},
  clock: () => number = Date.now,
  onDiagnostic?: MaisonetteDiagnostics,
): MaisonetteSearchResult {
  if (
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffff_ffff ||
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 2 ||
    options.maxNodes > MAX_SEARCH_NODES ||
    !Number.isFinite(options.maxTimeMs) ||
    options.maxTimeMs < 1 ||
    options.maxTimeMs > MAX_SEARCH_TIME_MS
  )
    throw new Error('Invalid maisonette search budget');
  if (query.model.id !== house.geometry.id)
    throw new Error('Maisonette query/model mismatch');

  const began = clock();
  let nodesVisited = 0;
  let queries = 0;
  let nodeLimitHit = false;
  let verificationIncomplete = false;
  let lastProgressNode = -1;
  const elapsed = () => Math.max(0, clock() - began);
  const budgetReason = (): 'time-limit' | 'verification-limit' | undefined => {
    if (elapsed() >= options.maxTimeMs) return 'time-limit';
    if (queries >= MAX_MAISONETTE_QUERIES) return 'verification-limit';
    return undefined;
  };
  const candidateLimit = (): MaisonetteSearchFailureReason | undefined => {
    const exhausted = budgetReason();
    if (exhausted) return exhausted;
    if (nodesVisited >= options.maxNodes) {
      nodeLimitHit = true;
      return 'node-limit';
    }
    return undefined;
  };
  const progress = (stage: 'searching' | 'verifying', force = false) => {
    if (force || nodesVisited - lastProgressNode >= 32) {
      lastProgressNode = nodesVisited;
      onProgress(nodesVisited, elapsed(), stage);
    }
  };
  const fail = (
    reason: MaisonetteSearchFailureReason,
  ): MaisonetteSearchResult => ({
    status: 'path-not-found',
    reason,
    seed: options.seed,
    nodesVisited,
    elapsedMs: elapsed(),
    queries,
  });
  const failForCurrentBudget = () =>
    budgetReason() ?? (nodeLimitHit ? 'node-limit' : 'verification-limit');
  const diagnose = (event: MaisonetteSearchDiagnostic) => {
    if (!onDiagnostic) return;
    try {
      onDiagnostic(event);
    } catch {
      // Development instrumentation must not alter route eligibility.
    }
  };

  const entry = house.openings.entry;
  const exit = house.openings.ldk;
  const clearanceDimensions = [
    query.dimensions.clearance.x,
    query.dimensions.clearance.y,
    query.dimensions.clearance.z,
  ].sort((a, b) => a - b);
  const medianClearanceDimension = clearanceDimensions[1] ?? 0;
  const narrowOpeningWidth = Math.min(entry.clearWidthM, exit.clearWidthM);
  const passageComplexityRatio = Math.min(
    Math.max(medianClearanceDimension / narrowOpeningWidth, 0),
    1,
  );
  const fixedReferenceNodeShare =
    0.01 + 0.19 * passageComplexityRatio * passageComplexityRatio;
  const hybridNodeShare = 0.05 + 0.55 * passageComplexityRatio;
  const hybridEnabled = passageComplexityRatio >= 0.5;
  const entryNormalLength = Math.hypot(
    entry.normal.x,
    entry.normal.y,
    entry.normal.z,
  );
  const exitNormalLength = Math.hypot(
    exit.normal.x,
    exit.normal.y,
    exit.normal.z,
  );
  const regions = new Map(
    query.model.floorRegions.map((region) => [region.id, region]),
  );
  const startRegionIds = new Set(house.startRegionIds);
  const ldkApproachRegionIds = new Set(
    house.guide
      .filter((guide) => guide.stage === 'upper-hall')
      .map((guide) => guide.floorRegionId),
  );
  const openingDot = (opening: HousingOpening, state: FloorState): number =>
    opening.normal.x * state.pose.position.x +
    opening.normal.y * state.pose.position.y +
    opening.normal.z * state.pose.position.z;
  const staysBeforeLdkApproach = (
    start: FloorState,
    end: FloorState,
  ): boolean => {
    // The LDK opening plane is only meaningful on its own upper-floor
    // approach. Lower floors can overlap that plane in XZ projection without
    // being anywhere near the doorway.
    if (
      !ldkApproachRegionIds.has(start.floorRegionId) &&
      !ldkApproachRegionIds.has(end.floorRegionId)
    )
      return true;
    const support = (state: FloorState) =>
      extentAlongNormal(
        exit,
        halfExtents(query.dimensions.clearance, state.pose.rotation),
      );
    const angularSlack =
      2 *
      query.clearance.radius *
      Math.sin(rotationAngle(start.pose.rotation, end.pose.rotation) / 4);
    const maxSupport = Math.max(support(start), support(end)) + angularSlack;
    return (
      Math.max(openingDot(exit, start), openingDot(exit, end)) +
        maxSupport * exitNormalLength <=
      exit.approachPlaneM - exit.epsilonM * exitNormalLength + 1e-10
    );
  };
  const validateState = (
    state: FloorState,
    terminal = false,
    phase: MaisonetteCandidateDiagnostic['phase'] = 'reference',
    layerIndex: number | null = null,
  ): 'valid' | 'invalid' | 'stopped' => {
    const report = (
      status: MaisonetteCandidateDiagnostic['status'],
      detail: string | null,
    ) => {
      if (!onDiagnostic) return;
      diagnose({
        kind: 'candidate',
        phase,
        layerIndex,
        floorRegionId: state.floorRegionId,
        position: { ...state.pose.position },
        rotation: { ...state.pose.rotation },
        status,
        detail,
      });
    };
    const stopped = candidateLimit();
    if (stopped) {
      report('stopped', stopped);
      return 'stopped';
    }
    const region = regions.get(state.floorRegionId);
    if (!region) {
      report('blocked', 'missing-floor-region');
      return 'invalid';
    }
    if (terminal) {
      if (state.floorRegionId !== house.goalRegionId) {
        report('blocked', 'wrong-goal-region');
        return 'invalid';
      }
    } else if (!staysBeforeLdkApproach(state, state)) {
      report('blocked', 'ldk-approach-plane');
      return 'invalid';
    }
    if (queries + 2 > MAX_MAISONETTE_QUERIES) {
      report('stopped', 'verification-limit');
      return 'stopped';
    }
    nodesVisited++;
    queries += 2; // ModelQuery performs one packed and one clearance query.
    progress('searching');
    try {
      const result = query.query(
        state.pose,
        state.floorRegionId,
        POINT_PREDICTION_M,
      );
      if (elapsed() >= options.maxTimeMs) {
        report('stopped', 'time-limit');
        return 'stopped';
      }
      if (
        result.packed.status === 'unverified' ||
        result.clearance.status === 'unverified'
      ) {
        verificationIncomplete = true;
        report(
          'unverified',
          `packed=${result.packed.status}:${result.packed.intersectingSolidIds.join(',')};clearance=${result.clearance.status}:${result.clearance.intersectingSolidIds.join(',')}`,
        );
        return 'invalid';
      }
      const valid =
        result.packed.status === 'clear' &&
        result.clearance.status === 'clear' &&
        result.virtualViolationIds.length === 0 &&
        footprintLocation(region.footprint, state.pose.position) === 'inside';
      if (valid) {
        report('valid', null);
        return 'valid';
      }
      const footprint = footprintLocation(
        region.footprint,
        state.pose.position,
      );
      report(
        'blocked',
        `packed=${result.packed.status}:${result.packed.intersectingSolidIds.join(',')};clearance=${result.clearance.status}:${result.clearance.intersectingSolidIds.join(',')};virtual=${result.virtualViolationIds.join(',') || 'none'};footprint=${footprint}`,
      );
      return 'invalid';
    } catch {
      verificationIncomplete = true;
      report('unverified', 'query-exception');
      return 'invalid';
    }
  };
  const verifyEdge = (
    start: FloorState,
    end: FloorState,
    final = false,
    terminalCrossing = false,
    phase: MaisonetteEdgeDiagnostic['phase'] = 'layer-connect',
    layerIndex: number | null = null,
    maxQueries?: number,
  ): CheckResult => {
    const totalQueriesBefore = queries;
    const maxDepth = final ? FINAL_EDGE_MAX_DEPTH : EDGE_MAX_DEPTH;
    const report = (
      status: MaisonetteEdgeDiagnostic['status'],
      queryBudget: number,
      detail: string | null,
    ) =>
      diagnose({
        kind: 'edge',
        phase,
        layerIndex,
        fromFloorRegionId: start.floorRegionId,
        toFloorRegionId: end.floorRegionId,
        maxDepth,
        queryBudget,
        queriesUsed: queries - totalQueriesBefore,
        totalQueriesBefore,
        totalQueriesAfter: queries,
        status,
        detail,
      });
    const stopped = budgetReason();
    if (stopped) {
      report(stopped, 0, 'search-budget-exhausted');
      return stopped;
    }
    // While the centre is on the exterior approach, the cargo may move
    // sideways or turn but must not retreat from the entry opening.
    if (
      startRegionIds.has(start.floorRegionId) &&
      openingDot(entry, end) + 1e-10 < openingDot(entry, start)
    ) {
      report('blocked', 0, 'entry-initial-retreat');
      return 'blocked';
    }
    if (!terminalCrossing && !staysBeforeLdkApproach(start, end)) {
      report('blocked', 0, 'ldk-approach-plane');
      return 'blocked';
    }
    const remaining = MAX_MAISONETTE_QUERIES - queries;
    if (remaining < 2) {
      report('verification-limit', 0, 'global-query-budget');
      return 'verification-limit';
    }
    const queryBudget = Math.min(maxQueries ?? 100_000, remaining - 1);
    queries++; // Count the independent model-motion verification call itself.
    try {
      const result = verifyModelMotion(query, start, end, {
        maxDepth,
        maxQueries: queryBudget,
        shouldStop: () => elapsed() >= options.maxTimeMs,
      });
      queries += result.queries;
      if (elapsed() >= options.maxTimeMs) {
        report('time-limit', queryBudget, result.status);
        return 'time-limit';
      }
      if (result.status === 'verified') {
        report('verified', queryBudget, null);
        return 'verified';
      }
      if (result.status === 'blocked') {
        report('blocked', queryBudget, result.constraintId ?? 'blocked');
        return 'blocked';
      }
      verificationIncomplete = true;
      report('unverified', queryBudget, result.reason);
      return 'unverified';
    } catch {
      verificationIncomplete = true;
      report('unverified', queryBudget, 'exception');
      return 'unverified';
    }
  };
  const found = (states: readonly FloorState[]): MaisonetteSearchResult => ({
    status: 'path-found',
    poses: states.map((state) => state.pose),
    floorRegionIds: states.map((state) => state.floorRegionId),
    seed: options.seed,
    nodesVisited,
    elapsedMs: elapsed(),
    queries,
  });

  if (
    entryNormalLength < 1e-12 ||
    exitNormalLength < 1e-12 ||
    !house.terminalReference.straightOnly ||
    house.terminalReference.regionId !== house.goalRegionId
  )
    throw new Error('Invalid maisonette route contract');

  const startRegionAt = (position: PointXZ): string | undefined =>
    house.startRegionIds.find((id) => {
      const region = regions.get(id);
      return (
        !!region && footprintLocation(region.footprint, position) === 'inside'
      );
    });
  const makeStartState = (
    rotation: Quaternion,
    transverse: number,
    liftM: number,
  ): FloorState | undefined => {
    const clearanceHalf = halfExtents(query.dimensions.clearance, rotation);
    const packedHalf = halfExtents(query.dimensions.packed, rotation);
    const support = extentAlongNormal(entry, clearanceHalf);
    const planeDot = entryStartCenterPlaneDot(entry);
    // The full clearance box must remain outside the entry approach plane.
    if (
      planeDot + support * entryNormalLength >
      entry.approachPlaneM - entry.epsilonM * entryNormalLength
    )
      return undefined;
    const position = entryStartCenterPosition(
      entry,
      transverse,
      entry.floorHeightM + liftM + packedHalf.y,
    );
    // The current two exterior floor regions tile startBounds exactly. Keep
    // the complete rotated clearance box over that finite floor rectangle.
    if (!clearanceInsideStartBounds(position, clearanceHalf, house.startBounds))
      return undefined;
    const floorRegionId = startRegionAt(position);
    if (!floorRegionId) return undefined;
    return {
      floorRegionId,
      pose: { position, rotation },
    };
  };
  const makeGoalState = (approach: FloorState): FloorState => {
    const rotation = approach.pose.rotation;
    const clearanceHalf = halfExtents(query.dimensions.clearance, rotation);
    const support = extentAlongNormal(exit, clearanceHalf);
    const planeDot =
      exit.departurePlaneM + support + exit.epsilonM * exitNormalLength;
    const transverse = transverseCoordinate(exit, approach.pose.position);
    const position = openingPosition(
      exit,
      planeDot,
      transverse,
      approach.pose.position.y,
    );
    return {
      floorRegionId: house.goalRegionId,
      pose: { position, rotation },
    };
  };
  const openingTransverseCandidates = (
    opening: HousingOpening,
    rotation: Quaternion,
  ): number[] =>
    maisonetteOpeningTransverseCandidates(
      opening,
      rotation,
      query.dimensions.clearance,
    );
  const minLift = Math.max(
    query.dimensions.snapshot.marginMm / 1000 + NUMERICAL_ERROR_M * 2,
    0.02,
  );
  const maxLift = Math.min(0.72 - 0.001, Math.max(minLift, 0.72 - 0.001));
  const lifts = (floorHeightM: number, stage?: RouteStage): number[] => {
    const baseLift = Math.min(Math.max(BASE_LIFT_M, minLift), maxLift);
    const lowLifts = [minLift, 0.04, 0.05, 0.08].map((value) =>
      Math.min(Math.max(value, minLift), maxLift),
    );
    const middleLifts = [0.3, 0.38, 0.42, 0.54, 0.55, 0.58, 0.62, 0.66].map(
      (value) => Math.min(Math.max(value, minLift), maxLift),
    );
    const highLifts = [HIGH_LIFT_M, maxLift].map((value) =>
      Math.min(Math.max(value, minLift), maxLift),
    );
    const ordered =
      stage === 'upper-hall'
        ? [...lowLifts, baseLift, ...middleLifts, ...highLifts]
        : [baseLift, ...middleLifts, ...highLifts, ...lowLifts];
    return uniqueNumbers(ordered).filter((value) =>
      Number.isFinite(floorHeightM + value),
    );
  };

  // Try the reference guide as one fully checked candidate path. Every state is
  // queried and every edge, including both openings, goes through floor/portal verification.
  const terminalGuideIndex = house.guide.findIndex(
    (guide) => guide.floorRegionId === house.goalRegionId,
  );
  if (terminalGuideIndex < 0 || terminalGuideIndex !== house.guide.length - 1)
    throw new Error('Maisonette guide must end at its terminal reference');
  const approachGuides = house.guide.slice(0, terminalGuideIndex);
  const terminalDoorGuide = approachGuides.at(-1);
  if (!terminalDoorGuide || terminalDoorGuide.stage !== 'ldk')
    throw new Error('Maisonette guide must identify its terminal doorway');
  // The final upper-hall waypoint and doorway threshold are not rotation
  // candidates. A dimension-dependent approach point is generated on the
  // upper-hall floor before the LDK approach plane; from there the item keeps
  // its pose and travels straight through the threshold to the receiver.
  const terminalApproachGuide = approachGuides.at(-2);
  const routeGuides = approachGuides.slice(0, -2);
  if (!terminalApproachGuide || terminalApproachGuide.stage !== 'upper-hall')
    throw new Error(
      'Maisonette route must approach the LDK from its upper hall',
    );
  const terminalApproachFloorRegionId = terminalApproachGuide.floorRegionId;
  const terminalApproachFloorHeightM = regions.get(
    terminalApproachFloorRegionId,
  )?.floorHeightM;
  if (terminalApproachFloorHeightM === undefined)
    throw new Error('Unknown LDK approach floor region');

  const makeApproachState = (
    rotation: Quaternion,
    transverse: number,
    y: number,
  ): FloorState => {
    const support = extentAlongNormal(
      exit,
      halfExtents(query.dimensions.clearance, rotation),
    );
    const planeDot =
      exit.approachPlaneM - support - exit.epsilonM * exitNormalLength;
    return {
      floorRegionId: terminalApproachFloorRegionId,
      pose: {
        position: openingPosition(exit, planeDot, transverse, y),
        rotation,
      },
    };
  };

  const rotations = maisonetteOrientationCandidates(options.seed);
  const openingClearance = (
    opening: HousingOpening,
    floorHeightM: number,
    rotation: Quaternion,
  ): number => {
    const clearanceHalf = halfExtents(query.dimensions.clearance, rotation);
    const packedHalf = halfExtents(query.dimensions.packed, rotation);
    const widthClearance =
      opening.transverseMaxM -
      opening.transverseMinM -
      2 * extentAlongWidth(opening, clearanceHalf) -
      2 * NUMERICAL_ERROR_M;
    const verticalClearance = Math.max(
      ...uniqueNumbers([minLift, 0.04, 0.05, 0.08, BASE_LIFT_M]).map((lift) =>
        Math.min(
          floorHeightM +
            lift +
            packedHalf.y -
            clearanceHalf.y -
            opening.floorHeightM -
            opening.epsilonM,
          opening.floorHeightM +
            opening.clearHeightM -
            (floorHeightM + lift + packedHalf.y + clearanceHalf.y) -
            opening.epsilonM,
        ),
      ),
    );
    return Math.min(widthClearance, verticalClearance);
  };
  const rankOpeningRotations = (
    opening: HousingOpening,
    floorHeightM: number,
  ) =>
    rotations
      .map((rotation, index) => ({
        rotation,
        index,
        clearance: openingClearance(opening, floorHeightM, rotation),
      }))
      .filter(({ clearance }) => clearance >= 0)
      .sort((a, b) => b.clearance - a.clearance || a.index - b.index);
  const entryReferenceRotations = rankOpeningRotations(
    entry,
    entry.floorHeightM,
  )
    .slice(0, 24)
    .map(({ rotation }) => rotation);
  const exitReferenceRotations = rankOpeningRotations(
    exit,
    terminalApproachFloorHeightM,
  )
    .slice(0, 24)
    .map(({ rotation }) => rotation);
  const fixedReferenceRotations = rotations
    .map((rotation) => ({
      rotation,
      clearance: Math.min(
        openingClearance(entry, entry.floorHeightM, rotation),
        openingClearance(exit, terminalApproachFloorHeightM, rotation),
      ),
    }))
    .filter(({ clearance }) => clearance >= 0)
    .sort((a, b) => b.clearance - a.clearance)
    .slice(0, 22)
    .map(({ rotation }) => rotation);
  const entryTransverses = (rotation: Quaternion) =>
    openingTransverseCandidates(entry, rotation);
  const referenceLifts = uniqueNumbers(
    [BASE_LIFT_M, 0.55, 0.58, HIGH_LIFT_M, 0.04, 0.05, 0.66, maxLift].map(
      (value) => Math.min(Math.max(value, minLift), maxLift),
    ),
  );
  // Fixed references and the local turning maneuver have separate allowances.
  // The shape-to-opening ratio only allocates search effort; it never proves fit.
  const fixedReferenceNodeLimit = Math.max(
    1,
    Math.floor(options.maxNodes * fixedReferenceNodeShare),
  );
  let fixedReferenceBudgetExhausted = false;
  for (const rotation of fixedReferenceRotations) {
    if (fixedReferenceBudgetExhausted) break;
    for (const transverse of entryTransverses(rotation)) {
      if (fixedReferenceBudgetExhausted) break;
      for (const lift of referenceLifts) {
        if (fixedReferenceBudgetExhausted) break;
        const states: FloorState[] = [];
        const append = (
          state: FloorState,
          terminal = false,
          terminalCrossing = false,
        ): 'accepted' | 'rejected' | MaisonetteSearchFailureReason => {
          if (nodesVisited >= fixedReferenceNodeLimit) {
            fixedReferenceBudgetExhausted = true;
            return 'rejected';
          }
          const result = validateState(state, terminal);
          if (result === 'stopped') return failForCurrentBudget();
          if (result !== 'valid') return 'rejected';
          const previous = states.at(-1);
          if (previous) {
            const edge = verifyEdge(
              previous,
              state,
              false,
              terminalCrossing,
              'reference',
            );
            if (
              edge === 'time-limit' ||
              edge === 'verification-limit' ||
              edge === 'node-limit'
            )
              return edge;
            if (edge !== 'verified') {
              verificationIncomplete ||= edge === 'unverified';
              return 'rejected';
            }
          }
          states.push(state);
          return 'accepted';
        };
        const start = makeStartState(rotation, transverse, lift);
        if (!start) continue;
        let outcome = append(start);
        if (outcome === 'time-limit' || outcome === 'verification-limit')
          return fail(outcome);
        if (outcome === 'node-limit') return fail(outcome);
        if (outcome !== 'accepted') continue;
        for (const guide of routeGuides) {
          if (!regions.has(guide.floorRegionId)) {
            outcome = 'rejected';
            break;
          }
          const positions = obstacleBoundaryPositions(
            query,
            guide,
            rotation,
            lift,
          );
          let guideAccepted = false;
          for (const point of positions) {
            const state: FloorState = {
              floorRegionId: guide.floorRegionId,
              pose: {
                position: {
                  x: point.x,
                  y:
                    guide.floorHeightM +
                    lift +
                    halfExtents(query.dimensions.packed, rotation).y,
                  z: point.z,
                },
                rotation,
              },
            };
            outcome = append(state);
            if (
              outcome === 'time-limit' ||
              outcome === 'verification-limit' ||
              outcome === 'node-limit'
            )
              return fail(outcome);
            if (outcome === 'accepted') {
              guideAccepted = true;
              break;
            }
          }
          if (!guideAccepted) {
            outcome = 'rejected';
            break;
          }
        }
        if (outcome !== 'accepted') continue;
        const lastGuideState = states.at(-1);
        if (!lastGuideState) continue;
        const approach = makeApproachState(
          rotation,
          (exit.transverseMinM + exit.transverseMaxM) / 2,
          lastGuideState.pose.position.y,
        );
        outcome = append(approach);
        if (
          outcome === 'time-limit' ||
          outcome === 'verification-limit' ||
          outcome === 'node-limit'
        )
          return fail(outcome);
        if (outcome !== 'accepted') continue;
        const goal = makeGoalState(approach);
        outcome = append(goal, true, true);
        if (
          outcome === 'time-limit' ||
          outcome === 'verification-limit' ||
          outcome === 'node-limit'
        )
          return fail(outcome);
        if (outcome !== 'accepted') continue;

        progress('verifying', true);
        for (let index = 1; index < states.length; index++) {
          const before = states[index - 1];
          const after = states[index];
          if (!before || !after) return fail('verification-limit');
          const isTerminal = index === states.length - 1;
          const edge = verifyEdge(
            before,
            after,
            true,
            isTerminal,
            'reference-final',
            index - 1,
          );
          if (edge !== 'verified') {
            if (
              edge === 'time-limit' ||
              edge === 'verification-limit' ||
              edge === 'node-limit'
            )
              return fail(edge);
            return fail('verification-limit');
          }
        }
        if (elapsed() >= options.maxTimeMs) return fail('time-limit');
        return found(states);
      }
    }
  }

  const routeLiftProfile = (
    guide: RouteGuidePoint,
    guideIndex: number,
  ): number[] => {
    const region = regions.get(guide.floorRegionId);
    if (!region) return [];
    const upperBound = Math.min(
      maxLift,
      region.maxLiftM - NUMERICAL_ERROR_M * 2,
    );
    const nextGuide = routeGuides[guideIndex + 1];
    const profileForStairEntry =
      guide.stage !== 'stairs' && nextGuide?.stage === 'stairs';
    const upperStraight = house.stepLedger.some(
      (step) =>
        step.floorRegionId === guide.floorRegionId &&
        step.kind === 'upper-straight',
    );
    const profile = profileForStairEntry
      ? [0.58, 0.62, 0.54, 0.66, upperBound, 0.42, BASE_LIFT_M, 0.05, 0.04]
      : upperStraight
        ? [0.42, 0.54, 0.58, 0.62, 0.66, upperBound, 0.3, BASE_LIFT_M]
        : guide.stage === 'entry'
          ? [0.05, 0.04, minLift, 0.08, BASE_LIFT_M, 0.58]
          : guide.stage === 'stairs'
            ? [0.58, 0.62, 0.54, 0.66, upperBound, 0.42, BASE_LIFT_M, 0.3]
            : [minLift, 0.04, 0.05, 0.08, 0.3, BASE_LIFT_M, 0.55, 0.58];
    return uniqueNumbers(
      profile.map((lift) => Math.min(Math.max(lift, minLift), upperBound)),
    );
  };

  const tryHybridReference = (): MaisonetteSearchResult | undefined => {
    if (!hybridEnabled) return undefined;
    const fallbackReserveNodes = Math.floor(options.maxNodes * 0.2);
    const hybridNodeLimit = Math.min(
      options.maxNodes - fallbackReserveNodes,
      nodesVisited + Math.floor(options.maxNodes * hybridNodeShare),
    );
    let hybridNodeBudgetExhausted = false;
    if (nodesVisited >= hybridNodeLimit) return undefined;
    const validateHybridState = (
      state: FloorState,
      terminal = false,
      phase: MaisonetteCandidateDiagnostic['phase'] = 'reference',
      layerIndex: number | null = null,
    ): 'valid' | 'invalid' | 'stopped' => {
      if (nodesVisited >= hybridNodeLimit) {
        hybridNodeBudgetExhausted = true;
        return 'stopped';
      }
      return validateState(state, terminal, phase, layerIndex);
    };
    const stairHeights = routeGuides
      .filter((guide) => guide.stage === 'stairs')
      .map((guide) => regions.get(guide.floorRegionId)?.floorHeightM)
      .filter((height): height is number => height !== undefined);
    if (stairHeights.length === 0) return undefined;
    const orderedHeights = [...new Set(stairHeights)].sort((a, b) => a - b);
    const rises = orderedHeights
      .slice(1)
      .map((height, index) => height - (orderedHeights[index] ?? height))
      .filter((rise) => rise > 0);
    const typicalRise =
      rises[Math.floor(rises.length / 2)] ??
      (Math.max(...stairHeights) - Math.min(...stairHeights)) /
        Math.max(stairHeights.length - 1, 1);
    const pivotHeight = Math.max(...stairHeights) - 3 * typicalRise;
    const pivots = routeGuides
      .map((guide, index) => ({ guide, index }))
      .filter(({ guide, index }) => {
        const next = routeGuides[index + 1];
        const height = regions.get(guide.floorRegionId)?.floorHeightM;
        return (
          guide.stage === 'stairs' &&
          next?.stage === 'stairs' &&
          height !== undefined &&
          height >= pivotHeight
        );
      });
    if (pivots.length === 0) return undefined;

    const rankedRotationPairs = entryReferenceRotations.flatMap(
      (startRotation, startIndex) =>
        exitReferenceRotations.map((goalRotation, goalIndex) => ({
          startRotation,
          goalRotation,
          startIndex,
          goalIndex,
          turn: rotationAngle(startRotation, goalRotation),
          entryClearance: openingClearance(
            entry,
            entry.floorHeightM,
            startRotation,
          ),
          exitClearance: openingClearance(
            exit,
            terminalApproachFloorHeightM,
            goalRotation,
          ),
          horizontalFootprint: Math.max(
            halfExtents(query.dimensions.clearance, startRotation).x,
            halfExtents(query.dimensions.clearance, startRotation).z,
            halfExtents(query.dimensions.clearance, goalRotation).x,
            halfExtents(query.dimensions.clearance, goalRotation).z,
          ),
          projectedOpeningWidth: Math.max(
            2 *
              extentAlongWidth(
                entry,
                halfExtents(query.dimensions.clearance, startRotation),
              ),
            2 *
              extentAlongWidth(
                exit,
                halfExtents(query.dimensions.clearance, goalRotation),
              ),
          ),
        })),
    );
    const compareTurningPairs = (
      a: (typeof rankedRotationPairs)[number],
      b: (typeof rankedRotationPairs)[number],
    ) => {
      const rankOrder =
        a.startIndex + a.goalIndex - (b.startIndex + b.goalIndex) ||
        a.startIndex - b.startIndex ||
        a.goalIndex - b.goalIndex;
      const turnOrder =
        Math.abs(a.turn - Math.PI / 2) - Math.abs(b.turn - Math.PI / 2);
      return (
        turnOrder ||
        a.horizontalFootprint - b.horizontalFootprint ||
        a.projectedOpeningWidth - b.projectedOpeningWidth ||
        Math.min(b.entryClearance, b.exitClearance) -
          Math.min(a.entryClearance, a.exitClearance) ||
        rankOrder
      );
    };
    const rotationPairs = [
      ...rankedRotationPairs
        .filter(({ turn }) => turn < 1e-7)
        .sort((a, b) => {
          const rankOrder =
            a.startIndex + a.goalIndex - (b.startIndex + b.goalIndex) ||
            a.startIndex - b.startIndex ||
            a.goalIndex - b.goalIndex;
          return (
            rankOrder ||
            b.entryClearance +
              b.exitClearance -
              (a.entryClearance + a.exitClearance)
          );
        })
        .slice(0, 1),
      ...rankedRotationPairs
        .filter(({ turn }) => turn >= (55 * Math.PI) / 180)
        .sort(compareTurningPairs)
        .slice(0, MAX_HYBRID_ROTATION_PAIRS),
    ];

    let maneuverAttempts = 0;
    for (const pair of rotationPairs) {
      for (const transverse of entryTransverses(pair.startRotation).slice(
        0,
        1,
      )) {
        for (const startLift of uniqueNumbers([0.05, 0.04])) {
          const start = makeStartState(
            pair.startRotation,
            transverse,
            Math.min(Math.max(startLift, minLift), maxLift),
          );
          if (!start) continue;
          const startStatus = validateHybridState(start, false, 'start', 0);
          if (startStatus === 'stopped' && hybridNodeBudgetExhausted)
            return undefined;
          if (startStatus === 'stopped') return fail(failForCurrentBudget());
          if (startStatus !== 'valid') continue;

          const states: FloorState[] = [start];
          const appendGuide = (
            guide: RouteGuidePoint,
            guideIndex: number,
            rotation: Quaternion,
          ): boolean => {
            const previous = states.at(-1);
            const region = regions.get(guide.floorRegionId);
            if (!previous || !region) return false;
            const previousRegion = regions.get(previous.floorRegionId);
            if (!previousRegion) return false;
            const liftsForGuide = routeLiftProfile(guide, guideIndex);
            const upperStraight = house.stepLedger.some(
              (step) =>
                step.floorRegionId === guide.floorRegionId &&
                step.kind === 'upper-straight',
            );
            for (const lift of liftsForGuide) {
              const positions = uniquePositions([
                guide.positionXZ,
                ...obstacleBoundaryPositions(query, guide, rotation, lift),
              ]).filter(
                (point) =>
                  footprintLocation(region.footprint, point) === 'inside',
              );
              const positionLimit = upperStraight ? 20 : 16;
              for (const point of positions.slice(0, positionLimit)) {
                const target: FloorState = {
                  floorRegionId: guide.floorRegionId,
                  pose: {
                    position: {
                      x: point.x,
                      y:
                        region.floorHeightM +
                        lift +
                        halfExtents(query.dimensions.packed, rotation).y,
                      z: point.z,
                    },
                    rotation,
                  },
                };
                const targetStatus = validateHybridState(
                  target,
                  false,
                  'route-layer',
                  guideIndex,
                );
                if (targetStatus === 'stopped') return false;
                if (targetStatus !== 'valid') continue;
                const edge = verifyEdge(
                  previous,
                  target,
                  false,
                  false,
                  'layer-connect',
                  guideIndex,
                );
                if (edge === 'verified') {
                  states.push(target);
                  return true;
                }
                if (
                  edge === 'time-limit' ||
                  edge === 'verification-limit' ||
                  edge === 'node-limit'
                )
                  return false;

                if (previous.floorRegionId === target.floorRegionId) continue;
                const transfer: FloorState = {
                  floorRegionId: previous.floorRegionId,
                  pose: {
                    position: {
                      x: previous.pose.position.x,
                      y:
                        previousRegion.floorHeightM +
                        lift +
                        halfExtents(query.dimensions.packed, rotation).y,
                      z: previous.pose.position.z,
                    },
                    rotation,
                  },
                };
                if (
                  Math.abs(
                    transfer.pose.position.y - previous.pose.position.y,
                  ) < 1e-7
                )
                  continue;
                const transferStatus = validateHybridState(
                  transfer,
                  false,
                  'route-layer',
                  guideIndex,
                );
                if (transferStatus === 'stopped') return false;
                if (transferStatus !== 'valid') continue;
                const liftEdge = verifyEdge(
                  previous,
                  transfer,
                  false,
                  false,
                  'layer-connect',
                  guideIndex,
                );
                if (
                  liftEdge === 'time-limit' ||
                  liftEdge === 'verification-limit' ||
                  liftEdge === 'node-limit'
                )
                  return false;
                if (liftEdge !== 'verified') continue;
                const portalEdge = verifyEdge(
                  transfer,
                  target,
                  false,
                  false,
                  'layer-connect',
                  guideIndex,
                );
                if (portalEdge === 'verified') {
                  states.push(transfer, target);
                  return true;
                }
                if (
                  portalEdge === 'time-limit' ||
                  portalEdge === 'verification-limit' ||
                  portalEdge === 'node-limit'
                )
                  return false;
              }
            }
            return false;
          };

          const finishHybridRoute = (): MaisonetteSearchResult | undefined => {
            const routeLength = states.length;
            const lastGuideState = states.at(-1);
            if (!lastGuideState) return undefined;
            const approach = makeApproachState(
              pair.goalRotation,
              (exit.transverseMinM + exit.transverseMaxM) / 2,
              lastGuideState.pose.position.y,
            );
            const approachStatus = validateHybridState(
              approach,
              false,
              'terminal-approach',
              routeGuides.length,
            );
            if (approachStatus === 'stopped' && hybridNodeBudgetExhausted)
              return undefined;
            if (approachStatus === 'stopped')
              return fail(failForCurrentBudget());
            if (approachStatus !== 'valid') return undefined;
            const approachEdge = verifyEdge(
              lastGuideState,
              approach,
              false,
              false,
              'layer-connect',
              routeGuides.length,
            );
            if (approachEdge !== 'verified') {
              if (
                approachEdge === 'time-limit' ||
                approachEdge === 'verification-limit' ||
                approachEdge === 'node-limit'
              )
                return fail(approachEdge);
              return undefined;
            }
            states.push(approach);
            const goal = makeGoalState(approach);
            const goalStatus = validateHybridState(
              goal,
              true,
              'goal',
              routeGuides.length + 1,
            );
            if (goalStatus === 'stopped' && hybridNodeBudgetExhausted) {
              states.length = routeLength;
              return undefined;
            }
            if (goalStatus === 'stopped') {
              states.length = routeLength;
              return fail(failForCurrentBudget());
            }
            if (goalStatus !== 'valid') {
              states.length = routeLength;
              return undefined;
            }
            const goalEdge = verifyEdge(
              approach,
              goal,
              false,
              true,
              'layer-connect',
              routeGuides.length + 1,
            );
            if (goalEdge !== 'verified') {
              states.length = routeLength;
              if (
                goalEdge === 'time-limit' ||
                goalEdge === 'verification-limit' ||
                goalEdge === 'node-limit'
              )
                return fail(goalEdge);
              return undefined;
            }
            states.push(goal);
            progress('verifying', true);
            for (let index = 1; index < states.length; index++) {
              const before = states[index - 1];
              const after = states[index];
              if (!before || !after) {
                states.length = routeLength;
                return fail('verification-limit');
              }
              const check = verifyEdge(
                before,
                after,
                true,
                index === states.length - 1,
                'final-route',
                index - 1,
              );
              if (check !== 'verified') {
                states.length = routeLength;
                if (
                  check === 'time-limit' ||
                  check === 'verification-limit' ||
                  check === 'node-limit'
                )
                  return fail(check);
                return undefined;
              }
            }
            return found(states);
          };

          let prefixValid = true;
          for (
            let guideIndex = 0;
            guideIndex < routeGuides.length;
            guideIndex++
          ) {
            const guide = routeGuides[guideIndex];
            if (!guide) return fail('no-path');
            if (!appendGuide(guide, guideIndex + 1, pair.startRotation)) {
              if (hybridNodeBudgetExhausted) return undefined;
              const nextGuide = routeGuides[guideIndex + 1];
              const nextHeight = nextGuide
                ? regions.get(nextGuide.floorRegionId)?.floorHeightM
                : undefined;
              const canSkipStairHint =
                guide.stage === 'stairs' &&
                nextGuide?.stage === 'stairs' &&
                nextHeight !== undefined &&
                nextHeight - guide.floorHeightM <= 0.34 + 1e-8;
              if (
                canSkipStairHint &&
                nextGuide &&
                appendGuide(nextGuide, guideIndex + 2, pair.startRotation)
              ) {
                guideIndex++;
              } else {
                if (budgetReason() || nodeLimitHit)
                  return fail(failForCurrentBudget());
                prefixValid = false;
                break;
              }
            }
            if (!pivots.some((pivot) => pivot.index === guideIndex)) continue;
            if (pair.turn < 1e-7) continue;
            if (maneuverAttempts >= 2) continue;
            maneuverAttempts++;
            const maneuver = searchLocalMaisonetteManeuver({
              query,
              house,
              start: states.at(-1)!,
              goalRotation: pair.goalRotation,
              validateState: (state) =>
                validateHybridState(
                  state,
                  false,
                  'route-layer',
                  guideIndex + 1,
                ),
              verifyEdge: (before, after, maxQueries) => {
                const check = verifyEdge(
                  before,
                  after,
                  false,
                  false,
                  'layer-connect',
                  guideIndex,
                  maxQueries,
                );
                return check === 'verified' || check === 'blocked'
                  ? check
                  : 'unverified';
              },
              shouldStop: () =>
                (() => {
                  if (budgetReason() !== undefined || nodeLimitHit) return true;
                  if (nodesVisited >= hybridNodeLimit) {
                    hybridNodeBudgetExhausted = true;
                    return true;
                  }
                  return hybridNodeBudgetExhausted;
                })(),
            });
            if (budgetReason() || nodeLimitHit)
              return fail(failForCurrentBudget());
            if (hybridNodeBudgetExhausted) {
              return undefined;
            }
            if (!maneuver || maneuver.length < 2) continue;
            const maneuverStartLength = states.length;
            states.push(...maneuver.slice(1));
            let suffixValid = true;
            for (
              let suffixIndex = guideIndex + 1;
              suffixIndex < routeGuides.length;
              suffixIndex++
            ) {
              const suffixGuide = routeGuides[suffixIndex];
              if (
                !suffixGuide ||
                !appendGuide(suffixGuide, suffixIndex + 1, pair.goalRotation)
              ) {
                if (budgetReason() || nodeLimitHit)
                  return fail(failForCurrentBudget());
                if (hybridNodeBudgetExhausted) return undefined;
                suffixValid = false;
                break;
              }
            }
            if (!suffixValid) {
              states.splice(maneuverStartLength);
              continue;
            }

            const completed = finishHybridRoute();
            if (completed) return completed;
            states.splice(maneuverStartLength);
          }
          if (pair.turn < 1e-7 && prefixValid) {
            const completed = finishHybridRoute();
            if (completed) return completed;
          }
          if (!prefixValid) break;
          if (budgetReason() || nodeLimitHit)
            return fail(failForCurrentBudget());
        }
      }
    }
    return undefined;
  };
  const hybridReference = tryHybridReference();
  if (hybridReference) return hybridReference;

  const random = seededRandom(options.seed);
  const waypointPositions = (guide: RouteGuidePoint): readonly PointXZ[] => {
    const region = regions.get(guide.floorRegionId);
    if (!region) return [];
    const sampled = sampleConvexFootprint(region.footprint, random);
    return uniquePositions([guide.positionXZ, sampled]);
  };
  const startCandidates: SearchNode[] = [];
  let startUncertain = false;
  let startAttempts = 0;
  const startQueryCount = queries;
  for (const rotation of rotations) {
    const transverse = openingTransverseCandidates(entry, rotation);
    for (const value of transverse)
      for (const lift of lifts(entry.floorHeightM)) {
        const state = makeStartState(rotation, value, lift);
        if (!state) continue;
        startAttempts++;
        const result = validateState(state, false, 'start', 0);
        if (result === 'stopped') return fail(failForCurrentBudget());
        if (result === 'valid')
          startCandidates.push({
            state,
            parentIndex: undefined,
            lockedParentIndex: undefined,
          });
        else startUncertain ||= verificationIncomplete;
      }
  }
  diagnose({
    kind: 'layer',
    phase: 'candidates',
    layerIndex: 0,
    fromFloorRegionIds: [],
    toFloorRegionIds: [
      ...new Set(startCandidates.map((node) => node.state.floorRegionId)),
    ],
    fromCandidates: 0,
    toCandidates: startCandidates.length,
    reachableCandidates: 0,
    connectedCandidates: 0,
    edgeAttempts: startAttempts,
    verifiedEdges: 0,
    blockedEdges: 0,
    unverifiedEdges: startUncertain ? 1 : 0,
    queriesUsed: queries - startQueryCount,
    stopReason: null,
  });
  if (startCandidates.length === 0)
    return fail(startUncertain ? 'verification-limit' : 'start-invalid');

  const layers: SearchNode[][] = [startCandidates];
  for (const guide of routeGuides) {
    const layerQueryCount = queries;
    const region = regions.get(guide.floorRegionId);
    if (!region) return fail('no-path');
    const points = waypointPositions(guide);
    const liftCandidates = lifts(region.floorHeightM, guide.stage);
    const candidates: SearchNode[] = [];
    let attempts = 0;
    const tried = new Set<string>();
    const candidateKey = (
      rotation: Quaternion,
      point: PointXZ,
      lift: number,
    ) => {
      const sign =
        rotation.w < 0 ||
        (Math.abs(rotation.w) < 1e-12 &&
          (rotation.x < 0 || (Math.abs(rotation.x) < 1e-12 && rotation.y < 0)))
          ? -1
          : 1;
      return [
        guide.floorRegionId,
        point.x.toFixed(5),
        (
          region.floorHeightM +
          lift +
          halfExtents(query.dimensions.packed, rotation).y
        ).toFixed(5),
        point.z.toFixed(5),
        (rotation.x * sign).toFixed(6),
        (rotation.y * sign).toFixed(6),
        (rotation.z * sign).toFixed(6),
        (rotation.w * sign).toFixed(6),
      ].join(':');
    };
    const addCandidate = (
      rotation: Quaternion,
      point: PointXZ,
      lift: number,
    ): MaisonetteSearchFailureReason | undefined => {
      if (attempts >= MAX_LAYER_CANDIDATES) return undefined;
      const key = candidateKey(rotation, point, lift);
      if (tried.has(key)) return undefined;
      tried.add(key);
      attempts++;
      const state: FloorState = {
        floorRegionId: guide.floorRegionId,
        pose: {
          position: {
            x: point.x,
            y:
              region.floorHeightM +
              lift +
              halfExtents(query.dimensions.packed, rotation).y,
            z: point.z,
          },
          rotation,
        },
      };
      const result = validateState(state, false, 'route-layer', layers.length);
      if (result === 'stopped') return failForCurrentBudget();
      if (result === 'valid')
        candidates.push({
          state,
          parentIndex: undefined,
          lockedParentIndex: undefined,
        });
      return undefined;
    };
    // Reserve most of the layer budget for stair/doorway lift and position
    // alternatives. The first cube-axis orientations retain broad coverage;
    // later orientations are still sampled by the final refinement loop.
    const primaryOrientations = rotations.slice(0, 24);
    for (const rotation of primaryOrientations) {
      const point = points[0];
      const lift = liftCandidates[0];
      if (!point || lift === undefined) continue;
      const stopped = addCandidate(rotation, point, lift);
      if (stopped) return fail(stopped);
      if (attempts >= MAX_LAYER_CANDIDATES) break;
    }
    const preferredLiftRefinements =
      guide.stage === 'stairs'
        ? [0.58, 0.62, 0.54, 0.66, maxLift]
        : guide.stage === 'upper-hall'
          ? [minLift, 0.04, 0.05]
          : [0.04, 0.05, 0.58];
    const middleLifts = uniqueNumbers([
      ...preferredLiftRefinements,
      ...liftCandidates,
    ])
      .filter((lift) => Math.abs(lift - BASE_LIFT_M) > 1e-8)
      .filter((lift) =>
        liftCandidates.some((value) => Math.abs(value - lift) < 1e-8),
      )
      .slice(0, 2);
    const refinementCount = Math.floor(
      (MAX_LAYER_CANDIDATES - attempts) / Math.max(middleLifts.length * 4, 1),
    );
    for (const rotation of rotations.slice(0, refinementCount)) {
      for (const lift of middleLifts) {
        const positions = obstacleBoundaryPositions(
          query,
          guide,
          rotation,
          lift,
        );
        const refinementPoints = uniquePositions(
          [points[0], ...positions.slice(1, 4), points[1]].filter(
            (point): point is PointXZ => point !== undefined,
          ),
        ).slice(0, 4);
        for (const point of refinementPoints) {
          const stopped = addCandidate(rotation, point, lift);
          if (stopped) return fail(stopped);
          if (attempts >= MAX_LAYER_CANDIDATES) break;
        }
        if (attempts >= MAX_LAYER_CANDIDATES) break;
      }
      if (attempts >= MAX_LAYER_CANDIDATES) break;
    }
    for (const rotation of rotations) {
      for (const point of points) {
        for (const lift of liftCandidates) {
          if (point === points[0] && lift === liftCandidates[0]) continue;
          const stopped = addCandidate(rotation, point, lift);
          if (stopped) return fail(stopped);
          if (attempts >= MAX_LAYER_CANDIDATES) break;
        }
        if (attempts >= MAX_LAYER_CANDIDATES) break;
      }
      if (attempts >= MAX_LAYER_CANDIDATES) break;
    }
    layers.push(candidates);
    diagnose({
      kind: 'layer',
      phase: 'candidates',
      layerIndex: layers.length - 1,
      fromFloorRegionIds: [
        ...new Set(
          layers.at(-2)?.map((node) => node.state.floorRegionId) ?? [],
        ),
      ],
      toFloorRegionIds: [guide.floorRegionId],
      fromCandidates: layers.at(-2)?.length ?? 0,
      toCandidates: candidates.length,
      reachableCandidates: 0,
      connectedCandidates: 0,
      edgeAttempts: attempts,
      verifiedEdges: 0,
      blockedEdges: 0,
      unverifiedEdges: 0,
      queriesUsed: queries - layerQueryCount,
      stopReason: null,
    });
  }
  if (layers.length < 2) return fail('no-path');
  if (nodeLimitHit) return fail('node-limit');

  const lastMovableLayer = layers[layers.length - 1];
  if (!lastMovableLayer || lastMovableLayer.length === 0)
    return fail(verificationIncomplete ? 'verification-limit' : 'no-path');
  const terminalApproachCandidates: SearchNode[] = [];
  const approachQueryCount = queries;
  let approachAttempts = 0;
  for (const [parentIndex, parent] of lastMovableLayer.entries()) {
    for (const transverse of openingTransverseCandidates(
      exit,
      parent.state.pose.rotation,
    )) {
      const approach = makeApproachState(
        parent.state.pose.rotation,
        transverse,
        parent.state.pose.position.y,
      );
      const result = validateState(
        approach,
        false,
        'terminal-approach',
        layers.length,
      );
      approachAttempts++;
      if (result === 'stopped') return fail(failForCurrentBudget());
      if (result === 'valid')
        terminalApproachCandidates.push({
          state: approach,
          parentIndex: undefined,
          lockedParentIndex: parentIndex,
        });
      if (terminalApproachCandidates.length >= MAX_LAYER_CANDIDATES) break;
    }
    if (terminalApproachCandidates.length >= MAX_LAYER_CANDIDATES) break;
  }
  diagnose({
    kind: 'layer',
    phase: 'candidates',
    layerIndex: layers.length,
    fromFloorRegionIds: [
      ...new Set(lastMovableLayer.map((node) => node.state.floorRegionId)),
    ],
    toFloorRegionIds: [terminalApproachFloorRegionId],
    fromCandidates: lastMovableLayer.length,
    toCandidates: terminalApproachCandidates.length,
    reachableCandidates: 0,
    connectedCandidates: 0,
    edgeAttempts: approachAttempts,
    verifiedEdges: 0,
    blockedEdges: 0,
    unverifiedEdges: 0,
    queriesUsed: queries - approachQueryCount,
    stopReason: null,
  });
  if (terminalApproachCandidates.length === 0)
    return fail(verificationIncomplete ? 'verification-limit' : 'no-path');
  layers.push(terminalApproachCandidates);

  const goalCandidates: SearchNode[] = [];
  const goalQueryCount = queries;
  let goalAttempts = 0;
  const finalApproachLayer = layers[layers.length - 1];
  if (!finalApproachLayer) return fail('no-path');
  for (const [parentIndex, parent] of finalApproachLayer.entries()) {
    const goal = makeGoalState(parent.state);
    const result = validateState(goal, true, 'goal', layers.length);
    goalAttempts++;
    if (result === 'stopped') return fail(failForCurrentBudget());
    if (result === 'valid')
      goalCandidates.push({
        state: goal,
        parentIndex: undefined,
        lockedParentIndex: parentIndex,
      });
    if (goalCandidates.length >= MAX_LAYER_CANDIDATES) break;
  }
  diagnose({
    kind: 'layer',
    phase: 'candidates',
    layerIndex: layers.length,
    fromFloorRegionIds: [
      ...new Set(finalApproachLayer.map((node) => node.state.floorRegionId)),
    ],
    toFloorRegionIds: [house.goalRegionId],
    fromCandidates: finalApproachLayer.length,
    toCandidates: goalCandidates.length,
    reachableCandidates: 0,
    connectedCandidates: 0,
    edgeAttempts: goalAttempts,
    verifiedEdges: 0,
    blockedEdges: 0,
    unverifiedEdges: 0,
    queriesUsed: queries - goalQueryCount,
    stopReason: null,
  });
  if (goalCandidates.length === 0)
    return fail(verificationIncomplete ? 'verification-limit' : 'goal-invalid');
  layers.push(goalCandidates);
  if (nodeLimitHit) return fail('node-limit');

  const connectAdjacentLayers = (fromIndex: number) => {
    const toIndex = fromIndex + 1;
    const from = layers[fromIndex];
    const to = layers[toIndex];
    if (!from || !to) return 'no-path' as const;
    const layerQueryCount = queries;
    let edgeAttempts = 0;
    let verifiedEdges = 0;
    let blockedEdges = 0;
    let unverifiedEdges = 0;
    const reachable = from
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => fromIndex === 0 || node.parentIndex !== undefined);
    const reportLayer = (stopReason: MaisonetteSearchFailureReason | null) =>
      diagnose({
        kind: 'layer',
        phase: 'connections',
        layerIndex: fromIndex,
        fromFloorRegionIds: [
          ...new Set(from.map((node) => node.state.floorRegionId)),
        ],
        toFloorRegionIds: [
          ...new Set(to.map((node) => node.state.floorRegionId)),
        ],
        fromCandidates: from.length,
        toCandidates: to.length,
        reachableCandidates: reachable.length,
        connectedCandidates: to.filter((node) => node.parentIndex !== undefined)
          .length,
        edgeAttempts,
        verifiedEdges,
        blockedEdges,
        unverifiedEdges,
        queriesUsed: queries - layerQueryCount,
        stopReason,
      });
    const connectedRotations: { rotation: Quaternion; count: number }[] = [];
    for (let targetIndex = 0; targetIndex < to.length; targetIndex++) {
      const target = to[targetIndex];
      if (!target || target.parentIndex !== undefined) continue;
      const rotationCount = connectedRotations.find(
        (entry) =>
          rotationAngle(entry.rotation, target.state.pose.rotation) < 1e-8,
      );
      if (rotationCount && rotationCount.count >= MAX_CONNECTED_PER_ORIENTATION)
        continue;
      const lockedParent = target.lockedParentIndex !== undefined;
      const parentCandidates = reachable
        .filter(
          ({ index }) => !lockedParent || index === target.lockedParentIndex,
        )
        .filter(({ node }) =>
          lockedParent
            ? rotationAngle(
                node.state.pose.rotation,
                target.state.pose.rotation,
              ) < 1e-8
            : rotationAngle(
                node.state.pose.rotation,
                target.state.pose.rotation,
              ) <=
              MAX_ROTATION_STEP_RAD + 1e-8,
        )
        .sort(
          (a, b) =>
            stateMetric(query, a.node.state, target.state) -
            stateMetric(query, b.node.state, target.state),
        );
      for (const parent of parentCandidates.slice(0, MAX_PARENT_ATTEMPTS)) {
        const terminalCrossing = toIndex === layers.length - 1;
        const check = verifyEdge(
          parent.node.state,
          target.state,
          false,
          terminalCrossing,
          'layer-connect',
          fromIndex,
        );
        edgeAttempts++;
        if (check === 'verified') verifiedEdges++;
        else if (check === 'blocked') blockedEdges++;
        else if (check === 'unverified') unverifiedEdges++;
        if (check === 'verified') {
          target.parentIndex = parent.index;
          if (rotationCount) rotationCount.count++;
          else
            connectedRotations.push({
              rotation: target.state.pose.rotation,
              count: 1,
            });
          break;
        }
        if (
          check === 'time-limit' ||
          check === 'verification-limit' ||
          check === 'node-limit'
        ) {
          reportLayer(check);
          return check;
        }
        verificationIncomplete ||= check === 'unverified';
      }
      progress('searching');
      if (connectedRotations.length >= MAX_REACHABLE_PER_LAYER) break;
    }
    if (!to.some((node) => node.parentIndex !== undefined)) {
      const reason = verificationIncomplete ? 'verification-limit' : 'no-path';
      reportLayer(reason);
      return reason;
    }
    reportLayer(null);
    return 'connected' as const;
  };

  // The route guide defines only a sequence of candidate floor layers, not a
  // trusted path: alternate poses and floor points are independently queried,
  // and only verified adjacent edges become graph links. Keeping links between
  // adjacent layers also makes every reconstructed parent transition explicit.
  for (let fromIndex = 0; fromIndex < layers.length - 1; fromIndex++) {
    const connected = connectAdjacentLayers(fromIndex);
    if (connected === 'time-limit' || connected === 'verification-limit')
      return fail(connected);
    if (connected === 'node-limit') return fail('node-limit');
    if (connected === 'no-path') return fail('no-path');
  }

  const finalLayer = layers[layers.length - 1];
  const selectedGoal = finalLayer?.find(
    (node) => node.parentIndex !== undefined,
  );
  if (!selectedGoal || selectedGoal.parentIndex === undefined)
    return fail(
      verificationIncomplete
        ? 'verification-limit'
        : nodeLimitHit
          ? 'node-limit'
          : 'no-path',
    );

  const reversed: FloorState[] = [selectedGoal.state];
  let layerIndex = layers.length - 2;
  let nodeIndex = selectedGoal.parentIndex;
  while (layerIndex >= 0) {
    const layer = layers[layerIndex];
    const node = layer?.[nodeIndex];
    if (!node) return fail('no-path');
    reversed.push(node.state);
    if (layerIndex === 0) break;
    if (node.parentIndex === undefined) return fail('no-path');
    nodeIndex = node.parentIndex;
    layerIndex--;
  }
  const path = reversed.reverse();
  progress('verifying', true);
  for (let index = 1; index < path.length; index++) {
    const before = path[index - 1];
    const after = path[index];
    if (!before || !after) return fail('verification-limit');
    const check = verifyEdge(
      before,
      after,
      true,
      index === path.length - 1,
      'final-route',
      index - 1,
    );
    if (check !== 'verified') {
      if (
        check === 'time-limit' ||
        check === 'verification-limit' ||
        check === 'node-limit'
      )
        return fail(check);
      return fail('verification-limit');
    }
  }
  if (elapsed() >= options.maxTimeMs) return fail('time-limit');
  return found(path);
}

function uniqueNumbers(values: readonly number[]): number[] {
  const unique: number[] = [];
  for (const value of values)
    if (!unique.some((existing) => Math.abs(existing - value) < 1e-9))
      unique.push(value);
  return unique;
}

function stateMetric(query: ModelQuery, a: FloorState, b: FloorState): number {
  const delta = Math.hypot(
    a.pose.position.x - b.pose.position.x,
    a.pose.position.y - b.pose.position.y,
    a.pose.position.z - b.pose.position.z,
  );
  return (
    delta +
    query.clearance.radius * rotationAngle(a.pose.rotation, b.pose.rotation)
  );
}
