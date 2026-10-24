import { describe, expect, it, vi } from 'vitest';
import { IDENTITY, type Pose, type Vector3 } from '../src/domain/pose';
import { createPhysicalQuery } from '../src/geometry/physical-query';
import { createRapierDiagnosticFactory } from '../src/geometry/rapier-diagnostic-factory';
import {
  prismDistanceBounds,
  prismSeparation,
} from '../src/geometry/prism-separation';
import * as prismBounds from '../src/geometry/prism-separation';
import { closestSegmentPoints } from '../src/geometry/segment-distance';
import { prismVertices, type ConvexPrism } from '../src/model/geometry-model';

const point = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const translated = (solid: ConvexPrism, offset: number): ConvexPrism => ({
  ...solid,
  footprint: solid.footprint.map((p) => ({
    x: p.x + offset,
    z: p.z + offset,
  })),
  bottomM: solid.bottomM + offset,
  topM: solid.topM + offset,
});
const enclosure = (
  result: { lowerBoundM: number; upperBoundM: number | null },
  expected: number,
) => {
  expect(result.lowerBoundM).toBeLessThanOrEqual(expected + 1e-11);
  expect(result.upperBoundM).toBeGreaterThanOrEqual(expected - 1e-11);
  expect(result.upperBoundM! - result.lowerBoundM).toBeLessThan(0.00050001);
};

describe('finite segment witnesses', () => {
  const cases: {
    name: string;
    points: [Vector3, Vector3, Vector3, Vector3];
    expected: number;
  }[] = [
    {
      name: 'interior skew edges',
      points: [
        point(-1, 0, 0),
        point(1, 0, 0),
        point(0, -1, 0.03),
        point(0, 1, 0.03),
      ],
      expected: 0.03,
    },
    {
      name: 'parallel overlapping projections',
      points: [
        point(-2, 0, 0),
        point(2, 0, 0),
        point(-1, 0.01, 0),
        point(1, 0.01, 0),
      ],
      expected: 0.01,
    },
    {
      name: 'opposite parallel directions',
      points: [
        point(-2, 0, 0),
        point(2, 0, 0),
        point(1, 0.01, 0),
        point(-1, 0.01, 0),
      ],
      expected: 0.01,
    },
    {
      name: 'closest finite endpoints beyond the infinite-line intersection',
      points: [point(-1, 0, 0), point(1, 0, 0), point(2, 1, 0), point(2, 2, 0)],
      expected: Math.SQRT2,
    },
    {
      name: 'point and segment',
      points: [
        point(0, 0.02, 0),
        point(0, 0.02, 0),
        point(-1, 0, 0),
        point(1, 0, 0),
      ],
      expected: 0.02,
    },
    {
      name: 'two points',
      points: [
        point(0, 0, 0),
        point(0, 0, 0),
        point(0, 0.03, 0.04),
        point(0, 0.03, 0.04),
      ],
      expected: 0.05,
    },
    {
      name: 'very unequal edge lengths',
      points: [
        point(0, 0, 0),
        point(0, 0, 1e-9),
        point(-20, 0.02, 5e-10),
        point(20, 0.02, 5e-10),
      ],
      expected: 0.02,
    },
    {
      name: 'height whose square underflows',
      points: [
        point(0, 0, 0),
        point(0, 1e-200, 0),
        point(-1, 0, 0.01),
        point(1, 0, 0.01),
      ],
      expected: 0.01,
    },
  ];
  it.each(cases)('$name', ({ points, expected }) => {
    const [p0, p1, q0, q1] = points;
    for (const ordered of [
      [p0, p1, q0, q1],
      [p1, p0, q1, q0],
      [q0, q1, p0, p1],
    ] as const) {
      const pair = closestSegmentPoints(...ordered);
      expect(pair.distanceM).toBeCloseTo(expected, 12);
    }
  });
  it.each([1e-3, 1e-8, 1e-13, 0])(
    'keeps nearly parallel crossing-edge bounds at angle scale %s',
    (slope) => {
      const pair = closestSegmentPoints(
        point(-1, 0, 0),
        point(1, 0, 0),
        point(-1, -slope, 0.01),
        point(1, slope, 0.01),
      );
      expect(pair.distanceM).toBeGreaterThanOrEqual(0.01 - 1e-15);
      expect(pair.distanceM).toBeCloseTo(0.01, 12);
    },
  );
  it('rejects nonfinite endpoints', () => {
    expect(() =>
      closestSegmentPoints(
        point(NaN, 0, 0),
        point(0, 0, 0),
        point(0, 0, 0),
        point(1, 0, 0),
      ),
    ).toThrow();
  });
});

describe('independent prism distance refinements', () => {
  const cube: ConvexPrism = {
    id: 'analytical-cube',
    footprint: [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ],
    bottomM: -1,
    topM: 1,
  };
  it('rejects a contradictory oracle interval instead of reporting clear', async () => {
    const query = await createPhysicalQuery([cube], { x: 1, y: 1, z: 1 });
    const spy = vi.spyOn(prismBounds, 'prismDistanceBounds').mockReturnValue({
      separation: { lowerBoundM: 0.01, complete: true },
      lowerBoundM: 0.01,
      upperBoundM: 0.001,
    });
    try {
      expect(() =>
        query.query({ position: point(2, 2, 2), rotation: IDENTITY }, 1),
      ).toThrow('Inconsistent physical distance interval');
    } finally {
      spy.mockRestore();
    }
  });
  it.each([
    [0.3, 0.4],
    [0.7, 0.9],
  ])(
    'covers a tilted vertex over a face at Rx=%s,Rz=%s',
    async (xAngle, zAngle) => {
      const dimensions = { x: 0.2, y: 0.4, z: 0.6 };
      // Independent matrix row for Rx(xAngle) Rz(zAngle), not halfExtents().
      const halfY =
        0.1 * Math.abs(Math.cos(xAngle) * Math.sin(zAngle)) +
        0.2 * Math.abs(Math.cos(xAngle) * Math.cos(zAngle)) +
        0.3 * Math.abs(Math.sin(xAngle));
      const rotation = {
        x: Math.sin(xAngle / 2) * Math.cos(zAngle / 2),
        y: -Math.sin(xAngle / 2) * Math.sin(zAngle / 2),
        z: Math.cos(xAngle / 2) * Math.sin(zAngle / 2),
        w: Math.cos(xAngle / 2) * Math.cos(zAngle / 2),
      };
      for (const offset of [-15, 0, 15]) {
        const solid = translated({ ...cube, topM: 0 }, offset);
        const query = await createPhysicalQuery([solid], dimensions);
        for (const gap of [0.0001, 0.001, 0.03]) {
          const result = query.query(
            { position: point(offset, offset + halfY + gap, offset), rotation },
            1,
          );
          enclosure(result, gap);
          expect(result.status).toBe(gap >= 0.001 ? 'clear' : 'unverified');
        }
      }
    },
  );
  it.each([
    [0.02, 0, 0],
    [0.02, 0.03, 0],
    [0.02, 0.03, 0.04],
  ])(
    'tightens face/edge/corner distance for gaps %j,%j,%j',
    async (x, y, z) => {
      const dimensions = { x: 1, y: 1, z: 1 };
      // Independent orthogonal interval gaps give the Euclidean solid distance.
      const expected = Math.hypot(x, y, z);
      for (const offset of [-15, 0, 15]) {
        const solid = translated(cube, offset);
        const pose: Pose = {
          position: point(offset + 1.5 + x, offset + 1.5 + y, offset + 1.5 + z),
          rotation: IDENTITY,
        };
        const query = await createPhysicalQuery([solid], dimensions);
        const result = query.query(pose, 0);
        enclosure(result, expected);
        expect(result.status).toBe('clear');
        const vertices = prismVertices(solid);
        expect(
          prismSeparation(vertices, solid.footprint, dimensions, pose)
            .lowerBoundM,
        ).toBeCloseTo(Math.max(x, y, z), 12);
        const nominal = prismDistanceBounds(
          vertices,
          solid.footprint,
          dimensions,
          pose,
        );
        expect(nominal.lowerBoundM).toBeCloseTo(expected, 12);
        expect(nominal.upperBoundM).toBeCloseTo(expected, 12);
      }
    },
  );
  it('finds the minimum between long edge interiors when every vertex is distant', async () => {
    const solid = { ...cube, topM: 0 };
    const query = await createPhysicalQuery([solid], { x: 0.2, y: 0.2, z: 4 });
    const angle = Math.PI / 4;
    // The lowest box edge crosses above the prism top with a 1 mm Y gap.
    // All box vertices lie beyond the prism's Z range; prism corners are outside
    // the narrow box. The closest top-edge pairs are interior points of both.
    const pose: Pose = {
      position: point(0, 0.1 * Math.SQRT2 + 0.001, 0),
      rotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
    };
    const result = query.query(pose, 1);
    enclosure(result, 0.001);
    expect(result.status).toBe('clear');
  });
  it.each([0.1, 1e-5, 1e-10, 0])(
    'covers a unique skew/near-parallel edge pair at %s rad',
    async (epsilon) => {
      const solid: ConvexPrism = {
        id: 'analytical-triangle',
        footprint: [
          { x: -1, z: -1 },
          { x: 1, z: -1 },
          { x: 0, z: 0 },
        ],
        bottomM: -1,
        topM: 1,
      };
      const dimensions = { x: 2, y: 0.2, z: 0.2 };
      const roll = Math.PI / 4,
        yaw = Math.PI / 2 - epsilon;
      // q = Rz(yaw) Rx(roll). The selected long box edge stays in the XY plane;
      // the pillar support edge is vertical. Their common-normal distance is gap.
      const rotation = {
        x: Math.cos(yaw / 2) * Math.sin(roll / 2),
        y: Math.sin(yaw / 2) * Math.sin(roll / 2),
        z: Math.sin(yaw / 2) * Math.cos(roll / 2),
        w: Math.cos(yaw / 2) * Math.cos(roll / 2),
      };
      for (const offset of [-15, 0, 15]) {
        for (const reversed of [false, true]) {
          const shifted = translated(solid, offset);
          const ordered = {
            ...shifted,
            footprint: reversed
              ? [...shifted.footprint].reverse()
              : shifted.footprint,
          };
          const query = await createPhysicalQuery([ordered], dimensions);
          for (const gap of [0, 0.0001, 0.001, 0.05]) {
            const pose: Pose = {
              position: point(offset, offset, offset + 0.1 * Math.SQRT2 + gap),
              rotation,
            };
            const result = query.query(pose, 1);
            enclosure(result, gap);
            expect(result.status).toBe(gap >= 0.001 ? 'clear' : 'unverified');
          }
        }
      }
    },
  );
  it('handles a thin triangular prism with positive volume', async () => {
    const solid: ConvexPrism = {
      id: 'thin-triangle',
      footprint: [
        { x: -1, z: -0.00001 },
        { x: 1, z: -0.00001 },
        { x: 0, z: 0 },
      ],
      bottomM: -0.0000005,
      topM: 0.0000005,
    };
    const query = await createPhysicalQuery(
      [solid],
      {
        x: 2,
        y: 0.002,
        z: 0.002,
      },
      { diagnosticFactory: createRapierDiagnosticFactory },
    );
    const angle = Math.PI / 4;
    const result = query.query(
      {
        position: point(0, 0, 0.001 * Math.SQRT2 + 0.001),
        rotation: {
          x: Math.sin(angle / 2),
          y: 0,
          z: 0,
          w: Math.cos(angle / 2),
        },
      },
      1,
    );
    enclosure(result, 0.001);
    expect(result.status).toBe('clear');
    expect(result.rapierUnavailableSolidIds).toEqual(['thin-triangle']);
    expect(result.rapierRangeMismatchIds).toEqual([]);
  });
});
