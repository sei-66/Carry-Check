import { rotateVector, type Pose, type Vector3 } from '../domain/pose';
import type { PointXZ } from '../model/geometry-model';
import { closestSegmentPoints } from './segment-distance';

const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (v: Vector3): Vector3 | null => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length < 1e-12
    ? null
    : { x: v.x / length, y: v.y / length, z: v.z / length };
};

interface ProjectionFrame {
  readonly boxAxes: readonly Vector3[];
  readonly relativeVertices: readonly Vector3[];
}

function projectionGap(
  vertices: readonly Vector3[],
  boxAxes: readonly Vector3[],
  dimensions: Vector3,
  axis: Vector3,
): number {
  const support =
    (dimensions.x * Math.abs(dot(axis, boxAxes[0]!)) +
      dimensions.y * Math.abs(dot(axis, boxAxes[1]!)) +
      dimensions.z * Math.abs(dot(axis, boxAxes[2]!))) /
    2;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const vertex of vertices) {
    const projection = dot(axis, vertex);
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  const gap = Math.max(minimum - support, -support - maximum);
  if (!Number.isFinite(gap)) throw new Error('Invalid separation bound');
  return gap;
}

const relative = (point: Vector3, origin: Vector3): Vector3 => ({
  x: point.x - origin.x,
  y: point.y - origin.y,
  z: point.z - origin.z,
});

function projectionFrame(
  vertices: readonly Vector3[],
  pose: Pose,
): ProjectionFrame {
  return {
    boxAxes: [
      rotateVector({ x: 1, y: 0, z: 0 }, pose.rotation),
      rotateVector({ x: 0, y: 1, z: 0 }, pose.rotation),
      rotateVector({ x: 0, y: 0, z: 1 }, pose.rotation),
    ],
    relativeVertices: vertices.map((vertex) => relative(vertex, pose.position)),
  };
}

// Independent f64 separating-axis LOWER distance bound for box/convex prism.
// It is not their Euclidean distance; diagonal cases can give a wide interval.
export function prismSeparation(
  vertices: readonly Vector3[],
  footprint: readonly PointXZ[],
  dimensions: Vector3,
  pose: Pose,
): { readonly lowerBoundM: number; readonly complete: boolean } {
  return prismSeparationWithFrame(
    footprint,
    dimensions,
    projectionFrame(vertices, pose),
  );
}

function prismSeparationWithFrame(
  footprint: readonly PointXZ[],
  dimensions: Vector3,
  frame: ProjectionFrame,
): { readonly lowerBoundM: number; readonly complete: boolean } {
  const { boxAxes, relativeVertices } = frame;
  const edges = [{ x: 0, y: 1, z: 0 }];
  const normals = [{ x: 0, y: 1, z: 0 }];
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i],
      b = footprint[(i + 1) % footprint.length];
    if (!a || !b) throw new Error('Invalid prism edge');
    const edge = unit({ x: b.x - a.x, y: 0, z: b.z - a.z });
    if (!edge) throw new Error('Degenerate prism edge');
    edges.push(edge);
    normals.push({ x: -edge.z, y: 0, z: edge.x });
  }
  const axes = [
    ...boxAxes,
    ...normals,
    ...boxAxes.flatMap((box) => edges.map((edge) => cross(box, edge))),
  ];
  let lower = -Infinity;
  let complete = true;
  for (const candidate of axes) {
    const axis = unit(candidate);
    if (!axis) {
      if (Math.hypot(candidate.x, candidate.y, candidate.z) > 0)
        complete = false;
      continue;
    }
    lower = Math.max(
      lower,
      projectionGap(relativeVertices, boxAxes, dimensions, axis),
    );
  }
  return { lowerBoundM: lower, complete };
}

// Validated prism + unit pose. Witnesses supply UPPER bounds; projections along
// their directions supply independent LOWER bounds. Missing a closest feature
// widens the interval instead of certifying an inaccurate candidate distance.
export function prismDistanceBounds(
  vertices: readonly Vector3[],
  footprint: readonly PointXZ[],
  dimensions: Vector3,
  pose: Pose,
) {
  const frame = projectionFrame(vertices, pose);
  const separation = prismSeparationWithFrame(footprint, dimensions, frame);
  const prism = frame.relativeVertices;
  const ring = footprint.map((p) => ({
    x: p.x - pose.position.x,
    z: p.z - pose.position.z,
  }));
  const bottom = Math.min(...prism.map((v) => v.y)),
    top = Math.max(...prism.map((v) => v.y));
  const boxAxes = frame.boxAxes;
  const inverse = {
    x: -pose.rotation.x,
    y: -pose.rotation.y,
    z: -pose.rotation.z,
    w: pose.rotation.w,
  };
  const boxVertices = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) => {
        return rotateVector(
          {
            x: (x * dimensions.x) / 2,
            y: (y * dimensions.y) / 2,
            z: (z * dimensions.z) / 2,
          },
          pose.rotation,
        );
      }),
    ),
  );
  let upper = Infinity;
  let lower = Math.max(0, separation.lowerBoundM);
  const consider = (boxPoint: Vector3, prismPoint: Vector3) => {
    const direction = relative(prismPoint, boxPoint);
    const candidate = Math.hypot(direction.x, direction.y, direction.z);
    if (candidate >= upper) return;
    if (!Number.isFinite(candidate))
      throw new Error('Invalid physical distance witness');
    upper = candidate;
    const axis = unit(direction);
    if (axis)
      lower = Math.max(lower, projectionGap(prism, boxAxes, dimensions, axis));
  };
  for (const point of prism) {
    const local = rotateVector(point, inverse);
    const clamped = {
      x: Math.max(-dimensions.x / 2, Math.min(dimensions.x / 2, local.x)),
      y: Math.max(-dimensions.y / 2, Math.min(dimensions.y / 2, local.y)),
      z: Math.max(-dimensions.z / 2, Math.min(dimensions.z / 2, local.z)),
    };
    consider(rotateVector(clamped, pose.rotation), point);
  }
  for (const point of boxVertices) {
    let positive = false,
      negative = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      if (!a || !b) throw new Error('Invalid prism face');
      const dx = b.x - a.x,
        dz = b.z - a.z,
        side = dx * (point.z - a.z) - dz * (point.x - a.x);
      positive ||= side > 0;
      negative ||= side < 0;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz),
        ),
      );
      consider(point, {
        x: a.x + t * dx,
        y: Math.max(bottom, Math.min(top, point.y)),
        z: a.z + t * dz,
      });
    }
    if (!positive || !negative)
      consider(point, {
        x: point.x,
        y: Math.max(bottom, Math.min(top, point.y)),
        z: point.z,
      });
  }
  // Avoid edge enumeration only when the independent nominal interval is
  // already narrower than 1 nm. This is an optimisation, not an exact oracle.
  if (upper - lower > 1e-9) {
    const prismEdges: (readonly [Vector3, Vector3])[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      if (!a || !b) throw new Error('Invalid prism edge');
      prismEdges.push(
        [
          { ...a, y: bottom },
          { ...b, y: bottom },
        ],
        [
          { ...a, y: top },
          { ...b, y: top },
        ],
        [
          { ...a, y: bottom },
          { ...a, y: top },
        ],
      );
    }
    for (const [index, start] of boxVertices.entries()) {
      for (const bit of [1, 2, 4]) {
        if (index & bit) continue;
        const end = boxVertices[index | bit];
        if (!end) throw new Error('Invalid box edge');
        for (const [a, b] of prismEdges) {
          const pair = closestSegmentPoints(start, end, a, b);
          consider(pair.first, pair.second);
        }
      }
    }
  }
  if (!Number.isFinite(upper)) throw new Error('Invalid physical upper bound');
  return {
    separation,
    lowerBoundM: lower,
    upperBoundM: upper,
  };
}
