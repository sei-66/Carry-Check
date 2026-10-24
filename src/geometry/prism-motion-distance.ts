import {
  interpolatePose,
  rotationAngle,
  rotateVector,
  type Pose,
  type Vector3,
} from '../domain/pose';
import type { PointXZ } from '../model/geometry-model';

const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Separating projections of an enclosure of the ENTIRE lerp/slerp sweep.
 * Omitting an axis widens the bound; it cannot falsely certify a gap. */
export function prismMotionLowerBound(
  vertices: readonly Vector3[],
  footprint: readonly PointXZ[],
  dimensions: Vector3,
  start: Pose,
  end: Pose,
): number {
  const midpoint = interpolatePose(start, end, 0.5);
  const boxAxes = [
    rotateVector({ x: 1, y: 0, z: 0 }, midpoint.rotation),
    rotateVector({ x: 0, y: 1, z: 0 }, midpoint.rotation),
    rotateVector({ x: 0, y: 0, z: 1 }, midpoint.rotation),
  ];
  const axes: Vector3[] = [...boxAxes, { x: 0, y: 1, z: 0 }];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i],
      b = footprint[(i + 1) % footprint.length];
    if (!a || !b) throw new Error('Invalid sweep footprint');
    axes.push({ x: -(b.z - a.z), y: 0, z: b.x - a.x });
  }
  const rotationEnvelope =
    Math.hypot(dimensions.x, dimensions.y, dimensions.z) *
    Math.sin(rotationAngle(start.rotation, end.rotation) / 4);
  const relative = (p: Vector3) => ({
    x: p.x - midpoint.position.x,
    y: p.y - midpoint.position.y,
    z: p.z - midpoint.position.z,
  });
  const a = relative(start.position),
    b = relative(end.position);
  const prism = vertices.map(relative);
  let lower = 0;
  for (const candidate of axes) {
    const length = Math.hypot(candidate.x, candidate.y, candidate.z);
    if (length < 1e-12) continue;
    const axis = {
      x: candidate.x / length,
      y: candidate.y / length,
      z: candidate.z / length,
    };
    const [x, y, z] = boxAxes;
    if (!x || !y || !z) throw new Error('Missing box axis');
    const support =
      (dimensions.x * Math.abs(dot(axis, x)) +
        dimensions.y * Math.abs(dot(axis, y)) +
        dimensions.z * Math.abs(dot(axis, z))) /
        2 +
      rotationEnvelope;
    const first = dot(axis, a),
      last = dot(axis, b);
    const projections = prism.map((p) => dot(axis, p));
    const gap = Math.max(
      Math.min(first, last) - support - Math.max(...projections),
      Math.min(...projections) - Math.max(first, last) - support,
    );
    if (!Number.isFinite(gap)) throw new Error('Invalid sweep lower bound');
    lower = Math.max(lower, gap);
  }
  return lower;
}
