import { describe, expect, it } from 'vitest';
import {
  createTurnFixture,
  TURN_FIXTURE_DIMENSIONS,
  TURN_FIXTURE_ID,
  TURN_FIXTURE_OUTER_HEIGHT,
} from '../src/dev/fixtures/turn-fixture';
import {
  prismVertices,
  validateConvexPrism,
  validateGeometryModel,
  type ConvexPrism,
  type GeometryModel,
  type PointXZ,
} from '../src/model/geometry-model';

function at(points: readonly PointXZ[], index: number): PointXZ {
  const point = points[index % points.length];
  if (!point) throw new Error('Missing test polygon point');
  return point;
}

// Independent shoelace oracle; production validation uses half-plane tests.
function signedArea(points: readonly PointXZ[]): number {
  return (
    points.reduce((sum, a, i) => {
      const b = at(points, i + 1);
      return sum + a.x * b.z - b.x * a.z;
    }, 0) / 2
  );
}

// Sutherland-Hodgman intersection in the test oracle. A zero area still permits
// the required shared edges/vertices, while detecting overlapping interiors.
function intersectionArea(
  subject: readonly PointXZ[],
  clip: readonly PointXZ[],
): number {
  let result = [...subject];
  const sign = Math.sign(signedArea(clip));
  for (const [i, a] of clip.entries()) {
    const b = at(clip, i + 1);
    const distance = (p: PointXZ) =>
      sign * ((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x));
    const input = result;
    result = [];
    for (const [j, end] of input.entries()) {
      const start = at(input, j + input.length - 1);
      const startDistance = distance(start);
      const endDistance = distance(end);
      if (startDistance >= 0 !== endDistance >= 0) {
        const t = startDistance / (startDistance - endDistance);
        result.push({
          x: start.x + t * (end.x - start.x),
          z: start.z + t * (end.z - start.z),
        });
      }
      if (endDistance >= 0) result.push(end);
    }
  }
  return Math.abs(signedArea(result));
}

function sharedBoundaryLength(
  first: readonly PointXZ[],
  second: readonly PointXZ[],
): number {
  let length = 0;
  for (const [i, a] of first.entries()) {
    const b = at(first, i + 1);
    const edgeLength = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / edgeLength;
    const dz = (b.z - a.z) / edgeLength;
    const onLine = (p: PointXZ) =>
      Math.abs(dx * (p.z - a.z) - dz * (p.x - a.x)) < 1e-12;
    for (const [j, c] of second.entries()) {
      const d = at(second, j + 1);
      if (!onLine(c) || !onLine(d)) continue;
      const cAlong = dx * (c.x - a.x) + dz * (c.z - a.z);
      const dAlong = dx * (d.x - a.x) + dz * (d.z - a.z);
      length += Math.max(
        0,
        Math.min(edgeLength, Math.max(cAlong, dAlong)) -
          Math.max(0, Math.min(cAlong, dAlong)),
      );
    }
  }
  return length;
}

function solid(model: GeometryModel, id: string): ConvexPrism {
  const result = model.physicalSolids.find((item) => item.id === id);
  if (!result) throw new Error(`Missing test solid ${id}`);
  return result;
}

describe('independent M0 turn fixture geometry', () => {
  it('has six closed floor prisms, a waist wall, and separate virtual data', () => {
    const model = createTurnFixture();
    expect(model.id).toBe(TURN_FIXTURE_ID);
    expect(model.physicalSolids.map((item) => item.id)).toEqual([
      'solid-F0',
      'solid-P1',
      'solid-P2',
      'solid-P3',
      'solid-P4',
      'solid-F5',
      'solid-waist',
    ]);
    expect(model.floorRegions).toHaveLength(6);
    expect(model.portals).toHaveLength(5);
    expect(model.outerConstraint).toEqual({
      id: 'constraint-outer',
      bounds: {
        min: { x: -0.8, y: -0.2, z: -0.25 },
        max: { x: 0.8, y: 2, z: 0.8 },
      },
    });
    expect(TURN_FIXTURE_OUTER_HEIGHT).toEqual({ minM: -0.2, maxM: 2 });
    expect(TURN_FIXTURE_DIMENSIONS.packed).toEqual({ x: 0.1, y: 0.1, z: 0.1 });
    expect(TURN_FIXTURE_DIMENSIONS.clearance).toEqual({
      x: 0.12,
      y: 0.12,
      z: 0.12,
    });
  });

  it('matches the analytic tread areas with no pairwise interior overlap', () => {
    const model = createTurnFixture();
    const areas = model.floorRegions.map((floor) =>
      signedArea(floor.footprint),
    );
    expect(areas[0]).toBeCloseTo(0.1875, 12);
    expect(areas[5]).toBeCloseTo(0.1875, 12);
    for (const area of areas.slice(1, 5)) expect(area).toBeCloseTo(0.31875, 12);
    expect(areas.slice(1, 5).reduce((a, b) => a + b, 0)).toBeCloseTo(1.275, 12);
    expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(1.65, 12);

    for (const [i, first] of model.physicalSolids.entries()) {
      for (const second of model.physicalSolids.slice(i + 1)) {
        expect(intersectionArea(first.footprint, second.footprint)).toBeCloseTo(
          0,
          12,
        );
      }
    }
    // Floors plus the wall tile the outer rectangle, with no missing area.
    const total = model.physicalSolids.reduce(
      (sum, item) => sum + signedArea(item.footprint),
      0,
    );
    expect(total).toBeCloseTo(1.6 * 1.05, 12);
    for (const item of model.physicalSolids) {
      for (const vertex of item.footprint) {
        expect(vertex.x).toBeGreaterThanOrEqual(-0.8);
        expect(vertex.x).toBeLessThanOrEqual(0.8);
        expect(vertex.z).toBeGreaterThanOrEqual(-0.25);
        expect(vertex.z).toBeLessThanOrEqual(0.8);
      }
    }
  });

  it('has only the five specified shared edges and five 180 mm rises', () => {
    const model = createTurnFixture();
    const floors = model.floorRegions;
    const pairs: string[] = [];
    for (const [i, first] of floors.entries()) {
      for (const second of floors.slice(i + 1)) {
        const length = sharedBoundaryLength(first.footprint, second.footprint);
        if (length > 1e-12) pairs.push(`${first.id}:${second.id}`);
      }
    }
    expect(pairs).toEqual([
      'region-F0:region-P1',
      'region-P1:region-P2',
      'region-P2:region-P3',
      'region-P3:region-P4',
      'region-P4:region-F5',
    ]);
    const expectedEdges = [
      [
        { x: -0.8, z: 0 },
        { x: -0.05, z: 0 },
      ],
      [
        { x: -0.05, z: 0.05 },
        { x: -0.8, z: 0.8 },
      ],
      [
        { x: 0, z: 0.05 },
        { x: 0, z: 0.8 },
      ],
      [
        { x: 0.05, z: 0.05 },
        { x: 0.8, z: 0.8 },
      ],
      [
        { x: 0.05, z: 0 },
        { x: 0.8, z: 0 },
      ],
    ];
    expect(model.portals.map((portal) => portal.edge)).toEqual(expectedEdges);
    expect(floors.map((floor) => floor.floorHeightM)).toEqual([
      0, 0.18, 0.36, 0.54, 0.72, 0.9,
    ]);
    let totalRise = 0;
    for (const portal of model.portals) {
      const from = floors.find((floor) => floor.id === portal.fromRegionId);
      const to = floors.find((floor) => floor.id === portal.toRegionId);
      if (!from || !to) throw new Error('Portal without test floor');
      const rise = to.floorHeightM - from.floorHeightM;
      expect(rise).toBeCloseTo(0.18, 12);
      totalRise += rise;
      expect(from.maxLiftM).toBe(0.6);
      expect(to.maxLiftM).toBe(0.6);
    }
    expect(totalRise).toBeCloseTo(0.9, 12);
  });

  it('extrudes the specified eight P1 vertices and the closed waist wall', () => {
    const model = createTurnFixture();
    expect(prismVertices(solid(model, 'solid-P1'))).toEqual([
      { x: -0.8, y: -0.2, z: 0 },
      { x: -0.05, y: -0.2, z: 0 },
      { x: -0.05, y: -0.2, z: 0.05 },
      { x: -0.8, y: -0.2, z: 0.8 },
      { x: -0.8, y: 0.18, z: 0 },
      { x: -0.05, y: 0.18, z: 0 },
      { x: -0.05, y: 0.18, z: 0.05 },
      { x: -0.8, y: 0.18, z: 0.8 },
    ]);
    expect(solid(model, 'solid-waist')).toEqual({
      id: 'solid-waist',
      bottomM: -0.2,
      topM: 1.2,
      footprint: [
        { x: -0.05, z: -0.25 },
        { x: 0.05, z: -0.25 },
        { x: 0.05, z: 0.05 },
        { x: -0.05, z: 0.05 },
      ],
    });
    for (const item of model.physicalSolids) {
      const vertices = prismVertices(item);
      expect(vertices).toHaveLength(8);
      expect(new Set(vertices.map((v) => JSON.stringify(v))).size).toBe(8);
      expect(item.bottomM).toBe(-0.2);
      expect(vertices.slice(0, 4).every((v) => v.y === -0.2)).toBe(true);
      expect(vertices.slice(4).every((v) => v.y === item.topM)).toBe(true);
    }
  });
});

describe('geometry model validation', () => {
  const base: ConvexPrism = {
    id: 'test-solid',
    bottomM: -0.2,
    topM: 0.18,
    footprint: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
    ],
  };

  it('accepts either winding and a thin, nondegenerate convex piece', () => {
    expect(() =>
      validateConvexPrism({
        ...base,
        footprint: [...base.footprint].reverse(),
      }),
    ).not.toThrow();
    expect(() =>
      validateConvexPrism({
        ...base,
        footprint: base.footprint.map((p) => ({ x: p.x * 0.00001, z: p.z })),
      }),
    ).not.toThrow();
  });

  it.each([
    { bottomM: 0.18 },
    { bottomM: 0.2 },
    { bottomM: NaN },
    { topM: Infinity },
    { id: '' },
  ])('rejects invalid solid extent or ID: %j', (change) => {
    expect(() => prismVertices({ ...base, ...change })).toThrow();
  });

  it.each([
    [],
    [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
    [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ],
    [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: 1 },
    ],
    [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 0.2, z: 0.2 },
      { x: 0, z: 1 },
    ],
    [
      { x: 0, z: 0 },
      { x: 1, z: 1 },
      { x: 0, z: 1 },
      { x: 1, z: 0 },
    ],
    [
      { x: 0, z: 0 },
      { x: NaN, z: 0 },
      { x: 0, z: 1 },
    ],
    [
      { x: 0, z: 0 },
      { x: 1, z: Infinity },
      { x: 0, z: 1 },
    ],
  ])(
    'rejects degenerate, nonconvex or nonfinite footprints: %j',
    (...points) => {
      expect(() => prismVertices({ ...base, footprint: points })).toThrow();
    },
  );

  it('rejects a self-crossing star even when every local turn has the same sign', () => {
    const ring = Array.from({ length: 5 }, (_, i) => ({
      x: Math.cos((i * Math.PI * 2) / 5),
      z: Math.sin((i * Math.PI * 2) / 5),
    }));
    const star = [0, 2, 4, 1, 3].map((index) => at(ring, index));
    expect(() => validateConvexPrism({ ...base, footprint: star })).toThrow();
  });

  it('rejects broken floor/solid references and inconsistent top heights', () => {
    const model = createTurnFixture();
    for (const change of [
      { physicalSolidId: 'missing' },
      { floorHeightM: 0.001 },
      { maxLiftM: -0.01 },
      { maxLiftM: Infinity },
      { footprint: base.footprint },
    ]) {
      expect(() =>
        validateGeometryModel({
          ...model,
          floorRegions: model.floorRegions.map((floor, i) =>
            i === 0
              ? {
                  ...floor,
                  ...change,
                  physicalSolidId:
                    change.physicalSolidId ??
                    floor.physicalSolidId ??
                    'missing',
                  basis: 'physical' as const,
                }
              : floor,
          ),
        }),
      ).toThrow();
    }
  });

  it('rejects a shortcut portal, partial edges, duplicate IDs and invalid bounds', () => {
    const model = createTurnFixture();
    expect(() =>
      validateGeometryModel({
        ...model,
        portals: model.portals.map((portal, i) =>
          i === 0 ? { ...portal, toRegionId: 'region-F5' } : portal,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateGeometryModel({
        ...model,
        portals: model.portals.map((portal, i) =>
          i === 0
            ? {
                ...portal,
                edge: [
                  { x: -0.7, z: 0 },
                  { x: -0.1, z: 0 },
                ],
              }
            : portal,
        ),
      }),
    ).toThrow();
    expect(() =>
      validateGeometryModel({
        ...model,
        physicalSolids: [...model.physicalSolids, solid(model, 'solid-F0')],
      }),
    ).toThrow();
    expect(() =>
      validateGeometryModel({
        ...model,
        outerConstraint: {
          ...model.outerConstraint,
          bounds: {
            min: model.outerConstraint.bounds.min,
            max: { x: 0.8, y: Infinity, z: 0.8 },
          },
        },
      }),
    ).toThrow();
  });
});
