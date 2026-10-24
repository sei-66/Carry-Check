import {
  halfExtents,
  rotationAngle,
  rotateVector,
  distance,
  interpolatePose,
  type Quaternion,
} from '../domain/pose';
import type {
  FloorState,
  ModelMotionVerification,
} from '../geometry/floor-motion';
import {
  footprintLocation,
  packedBottom,
  type ModelQuery,
} from '../geometry/model-query';
import type { MaisonetteModel } from '../model/maisonette-model';

export interface LocalMaisonetteManeuverOptions {
  readonly query: ModelQuery;
  readonly house: MaisonetteModel;
  readonly start: FloorState;
  readonly goalRotation: Quaternion;
  readonly validateState: (
    state: FloorState,
  ) => 'valid' | 'invalid' | 'stopped';
  readonly verifyEdge: (
    a: FloorState,
    b: FloorState,
    maxQueries: number,
  ) => ModelMotionVerification['status'];
  readonly shouldStop: () => boolean;
}

const TURN = Math.PI / 12;
const MAX_CANDIDATE_CHECKS = 3000;
const MAX_SETTLED = 180;
const MAX_PER_ROTATION = 400;
const INSET_M = 0.001;

function quaternion(yaw: number, pitch: number, roll: number): Quaternion {
  const sy = Math.sin(yaw / 2),
    cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2),
    cx = Math.cos(pitch / 2);
  const sz = Math.sin(roll / 2),
    cz = Math.cos(roll / 2);
  return {
    x: cy * sx * cz + sy * cx * sz,
    y: sy * cx * cz - cy * sx * sz,
    z: cy * cx * sz - sy * sx * cz,
    w: cy * cx * cz + sy * sx * sz,
  };
}

function angles(q: Quaternion): readonly [number, number, number] {
  const x = rotateVector({ x: 1, y: 0, z: 0 }, q);
  const y = rotateVector({ x: 0, y: 1, z: 0 }, q);
  const z = rotateVector({ x: 0, y: 0, z: 1 }, q);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -z.y)));
  return Math.abs(z.y) < 0.9999999
    ? [Math.atan2(z.x, z.z), pitch, Math.atan2(x.y, y.y)]
    : [Math.atan2(-x.z, x.x), pitch, 0];
}

function orientationKey(q: Quaternion): string {
  const sign = q.w < 0 ? -1 : 1;
  return [q.x, q.y, q.z, q.w].map((v) => (v * sign).toFixed(7)).join(',');
}

function unique(values: readonly number[]): number[] {
  return values.filter(
    (v, i) =>
      Number.isFinite(v) &&
      !values.slice(0, i).some((before) => Math.abs(before - v) < 1e-8),
  );
}

interface Node {
  readonly state: FloorState;
  readonly parent: number | null;
  readonly cost: number;
}

/** A bounded, same-floor connector. Geometry callbacks own every safety proof
 * and share the parent search's node/query/time budgets. No housing path is
 * trusted or injected; wall bounds only propose poses for those callbacks. */
export function searchLocalMaisonetteManeuver(
  options: LocalMaisonetteManeuverOptions,
): readonly FloorState[] | null {
  const {
    query,
    house,
    start,
    goalRotation,
    validateState,
    verifyEdge,
    shouldStop,
  } = options;
  const region = query.model.floorRegions.find(
    (r) => r.id === start.floorRegionId,
  );
  if (!region || shouldStop()) return null;
  const regionBounds = {
    minX: Math.min(...region.footprint.map((p) => p.x)),
    maxX: Math.max(...region.footprint.map((p) => p.x)),
    minZ: Math.min(...region.footprint.map((p) => p.z)),
    maxZ: Math.max(...region.footprint.map((p) => p.z)),
  };
  const walls = query.model.physicalSolids
    .filter((solid) => solid.topM >= query.model.outerConstraint.bounds.max.y)
    .map((solid) => ({
      minX: Math.min(...solid.footprint.map((p) => p.x)),
      maxX: Math.max(...solid.footprint.map((p) => p.x)),
      minZ: Math.min(...solid.footprint.map((p) => p.z)),
      maxZ: Math.max(...solid.footprint.map((p) => p.z)),
    }));
  const sideWalls = walls.filter(
    (wall) => wall.minZ <= regionBounds.minZ && wall.maxZ >= regionBounds.maxZ,
  );
  const left = Math.max(
    ...sideWalls
      .filter((w) => w.maxX <= regionBounds.minX + 1e-8)
      .map((w) => w.maxX),
  );
  const right = Math.min(
    ...sideWalls
      .filter((w) => w.minX >= regionBounds.maxX - 1e-8)
      .map((w) => w.minX),
  );
  const back = Math.min(
    ...walls
      .filter(
        (w) =>
          w.minZ >= regionBounds.maxZ &&
          w.minX <= regionBounds.minX &&
          w.maxX >= regionBounds.maxX,
      )
      .map((w) => w.minZ),
  );
  if (![left, right, back].every(Number.isFinite)) return null;
  const guide = house.guide.find((point) => point.floorRegionId === region.id);
  const centerZ =
    guide?.positionXZ.z ?? (regionBounds.minZ + regionBounds.maxZ) / 2;
  const centerX =
    guide?.positionXZ.x ?? (regionBounds.minX + regionBounds.maxX) / 2;
  const liftValues = unique([
    region.maxLiftM - INSET_M,
    0.66,
    0.58,
    0.54,
    0.42,
    0.3,
    packedBottom(start.pose, query.dimensions) - region.floorHeightM,
  ]).filter(
    (v) =>
      v >= query.dimensions.snapshot.marginMm / 1000 && v <= region.maxLiftM,
  );
  let checks = 0;
  let stopped = false;
  const orientationStates = new Map<string, readonly FloorState[]>();
  const candidates = (rotation: Quaternion): readonly FloorState[] => {
    const key = orientationKey(rotation);
    const previous = orientationStates.get(key);
    if (previous) return previous;
    const packedHalf = halfExtents(query.dimensions.packed, rotation);
    const half = halfExtents(query.dimensions.clearance, rotation);
    const lo = left + half.x + INSET_M;
    const hi = right - half.x - INSET_M;
    if (lo > hi) return [];
    const usableMidX = (lo + Math.min(hi, regionBounds.maxX - INSET_M)) / 2;
    const xValues = unique([
      lo,
      start.pose.position.x,
      centerX,
      usableMidX,
      regionBounds.maxX - INSET_M / 2,
      hi,
      regionBounds.maxX - INSET_M,
      ...Array.from({ length: 21 }, (_, i) => lo + ((hi - lo) * i) / 20),
    ]).filter((x) => x > regionBounds.minX && x < regionBounds.maxX);
    const zValues = unique([
      start.pose.position.z,
      centerZ,
      ...Array.from({ length: 14 }, (_, i) => back - half.z - 0.0005 - i * 0.1),
    ]).filter((z) => z > regionBounds.minZ && z < regionBounds.maxZ);
    const states: FloorState[] = [];
    let orientationChecks = 0;
    for (const x of xValues)
      for (const z of zValues)
        for (const lift of liftValues) {
          if (
            checks >= MAX_CANDIDATE_CHECKS ||
            orientationChecks >= MAX_PER_ROTATION
          )
            break;
          if (shouldStop()) {
            stopped = true;
            break;
          }
          const state: FloorState = {
            floorRegionId: region.id,
            pose: {
              rotation,
              position: { x, z, y: region.floorHeightM + lift + packedHalf.y },
            },
          };
          if (
            footprintLocation(region.footprint, state.pose.position) !==
            'inside'
          )
            continue;
          checks++;
          orientationChecks++;
          const status = validateState(state);
          if (status === 'stopped') {
            stopped = true;
            break;
          }
          if (status === 'valid') states.push(state);
        }
    orientationStates.set(key, states);
    return states;
  };
  const nodes: Node[] = [{ state: start, parent: null, cost: 0 }];
  const pending = [0];
  const reached = new Set<string>();
  const stateKey = (state: FloorState) =>
    [
      orientationKey(state.pose.rotation),
      ...['x', 'y', 'z'].map((axis) =>
        state.pose.position[axis as 'x' | 'y' | 'z'].toFixed(7),
      ),
    ].join('/');
  reached.add(stateKey(start));
  const metric = (a: FloorState, b: FloorState) =>
    distance(a.pose.position, b.pose.position) +
    query.clearance.radius * rotationAngle(a.pose.rotation, b.pose.rotation);
  let preparedStart = start;
  const preparation: FloorState[] = [start];
  // Prepare a turn from a wall-derived pose at an intermediate lift. In a
  // narrow stair, the guide centroid is not necessarily a useful turn origin.
  const startHalf = halfExtents(
    query.dimensions.clearance,
    start.pose.rotation,
  );
  const targetX = left + startHalf.x + INSET_M;
  const scorePreparation = (state: FloorState) =>
    Math.abs(
      packedBottom(state.pose, query.dimensions) - region.floorHeightM - 0.42,
    ) *
      10 +
    Math.abs(state.pose.position.x - targetX) * 10 -
    state.pose.position.z;
  for (const candidate of [...candidates(start.pose.rotation)]
    .sort((a, b) => scorePreparation(a) - scorePreparation(b))
    .slice(0, 3)) {
    if (shouldStop() || stopped) return null;
    if (verifyEdge(start, candidate, 1024) === 'verified') {
      preparedStart = candidate;
      preparation.push(candidate);
      break;
    }
  }
  // Try finite tilt/yaw/untilt motifs before a general neighbourhood graph.
  // These propose orientations only; callbacks certify all poses and edges.
  const [startYaw, startPitch, startRoll] = angles(start.pose.rotation);
  const [goalYaw, goalPitch, goalRoll] = angles(goalRotation);
  const yawDelta = Math.atan2(
    Math.sin(goalYaw - startYaw),
    Math.cos(goalYaw - startYaw),
  );
  if (
    Math.abs(startPitch) +
      Math.abs(startRoll) +
      Math.abs(goalPitch) +
      Math.abs(goalRoll) <
      1e-6 &&
    Math.abs(yawDelta) <= Math.PI / 2 + 1e-6
  ) {
    for (const rollSign of [-1, 1])
      for (const pitchSign of [-1, 1]) {
        const stages = [
          quaternion(startYaw, 0, rollSign * TURN * 2),
          quaternion(startYaw + yawDelta / 3, 0, rollSign * TURN * 2),
          quaternion(
            startYaw + (yawDelta * 2) / 3,
            pitchSign * TURN,
            rollSign * TURN * 2,
          ),
          quaternion(goalYaw, pitchSign * TURN * 2, rollSign * TURN),
          quaternion(goalYaw, pitchSign * TURN, 0),
          goalRotation,
        ];
        let beam: {
          state: FloorState;
          path: readonly FloorState[];
          cost: number;
        }[] = [{ state: preparedStart, path: preparation, cost: 0 }];
        for (const [stageIndex, rotation] of stages.entries()) {
          const available = candidates(rotation);
          const connected: typeof beam = [];
          const preferredLift =
            region.maxLiftM *
            (stageIndex < 3
              ? 1
              : stageIndex === 3
                ? 0.92
                : stageIndex === 4
                  ? 0.75
                  : 0.8);
          const ordered = [...available].sort(
            (a, b) =>
              (stageIndex === 2
                ? (b.pose.position.x - a.pose.position.x) * 10
                : 0) +
              (Math.abs(
                packedBottom(a.pose, query.dimensions) -
                  region.floorHeightM -
                  preferredLift,
              ) -
                Math.abs(
                  packedBottom(b.pose, query.dimensions) -
                    region.floorHeightM -
                    preferredLift,
                )) *
                10 +
              Math.min(...beam.map((parent) => metric(parent.state, a))) -
              Math.min(...beam.map((parent) => metric(parent.state, b))),
          );
          for (const state of ordered) {
            const liftBucket = Math.round(
              (packedBottom(state.pose, query.dimensions) -
                region.floorHeightM) *
                1000,
            );
            if (
              connected.some(
                (node) =>
                  Math.round(
                    (packedBottom(node.state.pose, query.dimensions) -
                      region.floorHeightM) *
                      1000,
                  ) === liftBucket,
              )
            )
              continue;
            const parents = [...beam].sort(
              (a, b) => metric(a.state, state) - metric(b.state, state),
            );
            for (const parent of parents.slice(0, 4)) {
              if (shouldStop() || stopped) return null;
              if (
                distance(parent.state.pose.position, state.pose.position) > 0.65
              )
                continue;
              let rejected = false;
              for (const t of [0.25, 0.5, 0.75]) {
                const status = validateState({
                  floorRegionId: region.id,
                  pose: interpolatePose(parent.state.pose, state.pose, t),
                });
                if (status === 'stopped') return null;
                if (status !== 'valid') {
                  rejected = true;
                  break;
                }
              }
              if (
                rejected ||
                verifyEdge(parent.state, state, 4096) !== 'verified'
              )
                continue;
              connected.push({
                state,
                path: [...parent.path, state],
                cost: parent.cost + metric(parent.state, state),
              });
              break;
            }
            if (connected.length >= 1) break;
          }
          beam = connected;
          if (!beam.length) break;
        }
        if (
          beam.length &&
          rotationAngle(beam[0]!.state.pose.rotation, goalRotation) < 1e-7
        )
          return beam[0]!.path;
      }
  }
  let settled = 0;
  while (pending.length && settled < MAX_SETTLED && !stopped && !shouldStop()) {
    pending.sort((a, b) => {
      const score = (index: number) => {
        const node = nodes[index]!;
        return (
          node.cost * 0.1 +
          rotationAngle(node.state.pose.rotation, goalRotation) * 2
        );
      };
      return score(a) - score(b);
    });
    const index = pending.shift();
    if (index === undefined) break;
    const current = nodes[index]!;
    settled++;
    if (rotationAngle(current.state.pose.rotation, goalRotation) < 1e-7) {
      const path: FloorState[] = [];
      let cursor: number | null = index;
      while (cursor !== null) {
        const node: Node = nodes[cursor]!;
        path.push(node.state);
        cursor = node.parent;
      }
      return path.reverse();
    }
    const [yaw, pitch, roll] = angles(current.state.pose.rotation);
    const rotations = [
      current.state.pose.rotation,
      ...([-1, 1] as const).flatMap((sign) => [
        quaternion(yaw + TURN * sign, pitch, roll),
        quaternion(yaw, pitch + TURN * sign, roll),
        quaternion(yaw, pitch, roll + TURN * sign),
      ]),
      ...(rotationAngle(current.state.pose.rotation, goalRotation) < Math.PI / 4
        ? [goalRotation]
        : []),
    ].sort(
      (a, b) => rotationAngle(a, goalRotation) - rotationAngle(b, goalRotation),
    );
    for (const rotation of rotations) {
      const near = candidates(rotation)
        .filter(
          (state) =>
            !reached.has(stateKey(state)) &&
            distance(current.state.pose.position, state.pose.position) < 0.55 &&
            rotationAngle(current.state.pose.rotation, state.pose.rotation) <
              Math.PI / 4 + 1e-8,
        )
        .sort((a, b) => metric(current.state, a) - metric(current.state, b));
      for (const state of near.slice(0, 18)) {
        if (shouldStop()) return null;
        // Reject a colliding midpoint before an adaptive edge can spend the
        // remaining global budget. This observation never proves the edge.
        const middle: FloorState = {
          floorRegionId: region.id,
          pose: interpolatePose(current.state.pose, state.pose, 0.5),
        };
        const midpoint = validateState(middle);
        if (midpoint === 'stopped') return null;
        if (midpoint !== 'valid') continue;
        const edge = verifyEdge(current.state, state, 512);
        if (edge !== 'verified') continue;
        reached.add(stateKey(state));
        nodes.push({
          state,
          parent: index,
          cost: current.cost + metric(current.state, state),
        });
        pending.push(nodes.length - 1);
      }
    }
  }
  return null;
}
