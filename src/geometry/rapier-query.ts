import RAPIER from '@dimforge/rapier3d-compat';
import {
  halfExtents,
  isPose,
  normalizeQuaternion,
  type Vector3,
} from '../domain/pose';
import { validateScene, validDimensions, type GeometryScene } from './scene';
import { NUMERICAL_ERROR_M } from './query-types';
import type { PoseQuery } from './query-types';

export { NUMERICAL_ERROR_M } from './query-types';
export type { ClearanceQuery, PoseQuery } from './query-types';

// Normalize unitless GJK tolerances for mm-sized geometry; the public API remains in m.
const QUERY_SCALE = 1000;
let initialization: Promise<void> | undefined;

export function initializeGeometry(): Promise<void> {
  initialization ??= RAPIER.init();
  return initialization;
}

// Shape queries allocate/free their temporary WASM shapes inside Rapier. No World.
export async function createPoseQuery(
  scene: GeometryScene,
  dimensions: Vector3,
): Promise<PoseQuery> {
  // Freeze the geometry logically before awaiting WASM; caller mutation cannot alter queries.
  scene = {
    bounds: { min: { ...scene.bounds.min }, max: { ...scene.bounds.max } },
    obstacles: scene.obstacles.map((obstacle) => ({
      id: obstacle.id,
      pose: {
        position: { ...obstacle.pose.position },
        rotation: { ...obstacle.pose.rotation },
      },
      shape:
        obstacle.shape.kind === 'cuboid'
          ? { kind: 'cuboid', dimensions: { ...obstacle.shape.dimensions } }
          : {
              kind: 'convex',
              vertices: obstacle.shape.vertices.map((vertex) => ({
                ...vertex,
              })),
            },
    })),
  };
  dimensions = { ...dimensions };
  validateScene(scene);
  if (!validDimensions(dimensions)) throw new Error('Invalid box');
  await initializeGeometry();
  const moving = new RAPIER.Cuboid(
    (dimensions.x * QUERY_SCALE) / 2,
    (dimensions.y * QUERY_SCALE) / 2,
    (dimensions.z * QUERY_SCALE) / 2,
  );
  const obstacles = scene.obstacles.map((obstacle) => ({
    ...obstacle,
    pose: {
      ...obstacle.pose,
      rotation: normalizeQuaternion(obstacle.pose.rotation),
    },
    solid:
      obstacle.shape.kind === 'cuboid'
        ? new RAPIER.Cuboid(
            (obstacle.shape.dimensions.x * QUERY_SCALE) / 2,
            (obstacle.shape.dimensions.y * QUERY_SCALE) / 2,
            (obstacle.shape.dimensions.z * QUERY_SCALE) / 2,
          )
        : new RAPIER.ConvexPolyhedron(
            new Float32Array(
              obstacle.shape.vertices.flatMap((v) => [
                v.x * QUERY_SCALE,
                v.y * QUERY_SCALE,
                v.z * QUERY_SCALE,
              ]),
            ),
          ),
  }));
  return {
    radius: Math.hypot(dimensions.x, dimensions.y, dimensions.z) / 2,
    bounds: { min: { ...scene.bounds.min }, max: { ...scene.bounds.max } },
    query(pose, predictionM) {
      if (
        !isPose(pose) ||
        [pose.position.x, pose.position.y, pose.position.z].some(
          (n) => Math.abs(n) > 20,
        ) ||
        !Number.isFinite(predictionM) ||
        predictionM < 0 ||
        predictionM > 100
      )
        throw new Error('Invalid distance query');
      pose = { ...pose, rotation: normalizeQuaternion(pose.rotation) };
      const extent = halfExtents(dimensions, pose.rotation);
      let lower = Infinity;
      let upper = Infinity;
      let obstacleId = 'bounds';
      for (const axis of ['x', 'y', 'z'] as const) {
        const gap = Math.min(
          pose.position[axis] - extent[axis] - scene.bounds.min[axis],
          scene.bounds.max[axis] - pose.position[axis] - extent[axis],
        );
        if (gap - NUMERICAL_ERROR_M < lower) {
          lower = gap - NUMERICAL_ERROR_M;
          obstacleId = `bounds-${axis}`;
        }
        upper = Math.min(upper, gap + NUMERICAL_ERROR_M);
      }
      for (const obstacle of obstacles) {
        // Recenter each pair before f32 conversion to preserve small gaps far from origin.
        const contact = moving.contactShape(
          { x: 0, y: 0, z: 0 },
          pose.rotation,
          obstacle.solid,
          {
            x: (obstacle.pose.position.x - pose.position.x) * QUERY_SCALE,
            y: (obstacle.pose.position.y - pose.position.y) * QUERY_SCALE,
            z: (obstacle.pose.position.z - pose.position.z) * QUERY_SCALE,
          },
          obstacle.pose.rotation,
          predictionM * QUERY_SCALE,
        );
        if (contact && !Number.isFinite(contact.distance))
          throw new Error('Invalid Rapier contact');
        // null gives a known lower bound, never a measured zero/infinite distance.
        const measuredDistance = contact
          ? contact.distance / QUERY_SCALE
          : null;
        const gapLower = (measuredDistance ?? predictionM) - NUMERICAL_ERROR_M;
        if (gapLower < lower) {
          lower = gapLower;
          obstacleId = obstacle.id;
        }
        if (measuredDistance !== null)
          upper = Math.min(upper, measuredDistance + NUMERICAL_ERROR_M);
      }
      return {
        status: lower > 0 ? 'clear' : 'blocked',
        lowerBoundM: lower,
        upperBoundM: Number.isFinite(upper) ? upper : null,
        obstacleId,
      };
    },
  };
}
