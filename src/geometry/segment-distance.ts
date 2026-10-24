import { distance, isVector3, type Vector3 } from '../domain/pose';

export interface SegmentPoints {
  readonly first: Vector3;
  readonly second: Vector3;
  readonly distanceM: number;
}

const subtract = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const along = (a: Vector3, b: Vector3, fraction: number): Vector3 => ({
  x: a.x + fraction * (b.x - a.x),
  y: a.y + fraction * (b.y - a.y),
  z: a.z + fraction * (b.z - a.z),
});

function project(point: Vector3, a: Vector3, b: Vector3): Vector3 {
  const delta = subtract(b, a);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length === 0) return a;
  const direction = {
    x: delta.x / length,
    y: delta.y / length,
    z: delta.z / length,
  };
  return along(a, b, clamp(dot(subtract(point, a), direction) / length));
}

// Boundary candidates always remain on the finite segments. An inaccurate or
// omitted near-parallel interior candidate can widen this UPPER bound; it must
// never serve as a distance lower bound. The caller certifies its own lower.
export function closestSegmentPoints(
  p0: Vector3,
  p1: Vector3,
  q0: Vector3,
  q1: Vector3,
): SegmentPoints {
  if (![p0, p1, q0, q1].every(isVector3))
    throw new Error('Invalid segment points');
  let result: SegmentPoints = {
    first: p0,
    second: q0,
    distanceM: distance(p0, q0),
  };
  const consider = (first: Vector3, second: Vector3) => {
    const distanceM = distance(first, second);
    if (Number.isFinite(distanceM) && distanceM < result.distanceM)
      result = { first, second, distanceM };
  };
  consider(p0, project(p0, q0, q1));
  consider(p1, project(p1, q0, q1));
  consider(project(q0, p0, p1), q0);
  consider(project(q1, p0, p1), q1);

  const p = subtract(p1, p0),
    q = subtract(q1, q0);
  const pLength = Math.hypot(p.x, p.y, p.z),
    qLength = Math.hypot(q.x, q.y, q.z);
  if (pLength > 0 && qLength > 0) {
    const u = { x: p.x / pLength, y: p.y / pLength, z: p.z / pLength },
      v = { x: q.x / qLength, y: q.y / qLength, z: q.z / qLength };
    const normal = cross(u, v),
      denominator = dot(normal, normal);
    // Cross products avoid subtracting nearly equal squared dot products.
    // Angles below this threshold use the valid boundary upper candidates.
    if (denominator > 1e-24) {
      const offset = subtract(q0, p0);
      const s = dot(cross(offset, v), normal) / denominator / pLength,
        t = dot(cross(offset, u), normal) / denominator / qLength;
      if (Number.isFinite(s) && Number.isFinite(t))
        consider(along(p0, p1, clamp(s)), along(q0, q1, clamp(t)));
    }
  }
  if (!Number.isFinite(result.distanceM))
    throw new Error('Invalid segment distance');
  return result;
}
