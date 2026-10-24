export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quaternion extends Vector3 {
  readonly w: number;
}

export interface Pose {
  readonly position: Vector3;
  readonly rotation: Quaternion;
}

export const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

export function isVector3(value: unknown): value is Vector3 {
  if (!value || typeof value !== 'object') return false;
  return ['x', 'y', 'z'].every(
    (key) => key in value && Number.isFinite(Reflect.get(value, key)),
  );
}

export function isQuaternion(value: unknown): value is Quaternion {
  return (
    isVector3(value) &&
    'w' in value &&
    typeof value.w === 'number' &&
    Number.isFinite(value.w) &&
    Math.abs(Math.hypot(value.x, value.y, value.z, value.w) - 1) < 1e-6
  );
}

export function isPose(value: unknown): value is Pose {
  return (
    !!value &&
    typeof value === 'object' &&
    'position' in value &&
    'rotation' in value &&
    isVector3(value.position) &&
    isQuaternion(value.rotation)
  );
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length < 1e-12)
    throw new Error('Invalid quaternion');
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function dot(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function rotationAngle(a: Quaternion, b: Quaternion): number {
  a = normalizeQuaternion(a);
  b = normalizeQuaternion(b);
  // Relative quaternion + atan2 preserves small rotations and tolerates the
  // accepted norm band without allowing a dot > 1 to erase the rotation.
  const x = a.w * b.x - a.x * b.w - a.y * b.z + a.z * b.y;
  const y = a.w * b.y + a.x * b.z - a.y * b.w - a.z * b.x;
  const z = a.w * b.z - a.x * b.y + a.y * b.x - a.z * b.w;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(dot(a, b)));
}

export function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Position lerp and shortest-arc slerp are also the future playback contract.
export function interpolatePose(a: Pose, b: Pose, fraction: number): Pose {
  if (
    !isPose(a) ||
    !isPose(b) ||
    fraction < 0 ||
    fraction > 1 ||
    !Number.isFinite(fraction)
  )
    throw new Error('Invalid interpolation');
  a = { ...a, rotation: normalizeQuaternion(a.rotation) };
  b = { ...b, rotation: normalizeQuaternion(b.rotation) };
  let end = b.rotation;
  const cosine = dot(a.rotation, end);
  if (cosine < 0) {
    end = { x: -end.x, y: -end.y, z: -end.z, w: -end.w };
  }
  const angle = rotationAngle(a.rotation, end) / 2;
  const sine = Math.sin(angle);
  const startWeight =
    angle === 0 ? 1 - fraction : Math.sin((1 - fraction) * angle) / sine;
  const endWeight = angle === 0 ? fraction : Math.sin(fraction * angle) / sine;
  return {
    position: {
      x: a.position.x + (b.position.x - a.position.x) * fraction,
      y: a.position.y + (b.position.y - a.position.y) * fraction,
      z: a.position.z + (b.position.z - a.position.z) * fraction,
    },
    rotation: normalizeQuaternion({
      x: startWeight * a.rotation.x + endWeight * end.x,
      y: startWeight * a.rotation.y + endWeight * end.y,
      z: startWeight * a.rotation.z + endWeight * end.z,
      w: startWeight * a.rotation.w + endWeight * end.w,
    }),
  };
}

export function rotateVector(v: Vector3, q: Quaternion): Vector3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

export function halfExtents(
  dimensions: Vector3,
  rotation: Quaternion,
): Vector3 {
  const x = rotateVector({ x: dimensions.x / 2, y: 0, z: 0 }, rotation);
  const y = rotateVector({ x: 0, y: dimensions.y / 2, z: 0 }, rotation);
  const z = rotateVector({ x: 0, y: 0, z: dimensions.z / 2 }, rotation);
  return {
    x: Math.abs(x.x) + Math.abs(y.x) + Math.abs(z.x),
    y: Math.abs(x.y) + Math.abs(y.y) + Math.abs(z.y),
    z: Math.abs(x.z) + Math.abs(y.z) + Math.abs(z.z),
  };
}

export function pointMotionBound(a: Pose, b: Pose, radius: number): number {
  return (
    distance(a.position, b.position) +
    2 * radius * Math.sin(rotationAngle(a.rotation, b.rotation) / 2)
  );
}
