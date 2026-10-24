import { isPose, isVector3, type Pose, type Vector3 } from '../domain/pose';

export interface Bounds {
  readonly min: Vector3;
  readonly max: Vector3;
}

export interface Obstacle {
  readonly id: string;
  readonly pose: Pose;
  readonly shape:
    | { readonly kind: 'cuboid'; readonly dimensions: Vector3 }
    | { readonly kind: 'convex'; readonly vertices: readonly Vector3[] };
}

export interface GeometryScene {
  readonly bounds: Bounds;
  readonly obstacles: readonly Obstacle[];
}

export function validDimensions(value: Vector3): boolean {
  return (
    isVector3(value) &&
    [value.x, value.y, value.z].every((n) => n >= 0.001 && n <= 20)
  );
}

function hasVolume(vertices: readonly Vector3[]): boolean {
  const a = vertices[0];
  if (!a) return false;
  for (const b of vertices.slice(1)) {
    for (const c of vertices.slice(1)) {
      const cross = {
        x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
        y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
        z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      };
      if (
        vertices.some(
          (d) =>
            Math.abs(
              cross.x * (d.x - a.x) +
                cross.y * (d.y - a.y) +
                cross.z * (d.z - a.z),
            ) > 1e-9,
        )
      )
        return true;
    }
  }
  return false;
}

export function validateScene(scene: GeometryScene): void {
  const { min, max } = scene.bounds;
  if (
    !isVector3(min) ||
    !isVector3(max) ||
    !(['x', 'y', 'z'] as const).every(
      (key) =>
        min[key] < max[key] &&
        Math.abs(min[key]) <= 20 &&
        Math.abs(max[key]) <= 20,
    )
  )
    throw new Error('Invalid bounds');
  if (scene.obstacles.length > 1000) throw new Error('Too many obstacles');
  const ids = new Set<string>();
  for (const obstacle of scene.obstacles) {
    if (
      !obstacle.id ||
      ids.has(obstacle.id) ||
      !isPose(obstacle.pose) ||
      [
        obstacle.pose.position.x,
        obstacle.pose.position.y,
        obstacle.pose.position.z,
      ].some((n) => Math.abs(n) > 20)
    )
      throw new Error('Invalid obstacle');
    ids.add(obstacle.id);
    if (obstacle.shape.kind === 'cuboid') {
      if (!validDimensions(obstacle.shape.dimensions))
        throw new Error('Invalid cuboid');
    } else {
      const vertices = obstacle.shape.vertices;
      if (
        vertices.length < 4 ||
        vertices.length > 64 ||
        !vertices.every(
          (v) =>
            isVector3(v) && [v.x, v.y, v.z].every((n) => Math.abs(n) <= 20),
        ) ||
        !hasVolume(vertices)
      )
        throw new Error('Invalid convex solid');
    }
  }
}
