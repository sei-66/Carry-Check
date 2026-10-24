import { describe, expect, it } from 'vitest';
import { IDENTITY, type Pose } from '../src/domain/pose';
import {
  createTurnFixture,
  TURN_FIXTURE_DIMENSIONS,
} from '../src/dev/fixtures/turn-fixture';
import {
  M1_REFERENCE_STATES,
  createM1CandidateQuery,
  prepareM1Benchmark,
} from '../src/dev/run-m1-benchmark';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import { createModelQuery } from '../src/geometry/model-query';
import { createPhysicalQuery } from '../src/geometry/physical-query';
import { createRapierDiagnosticFactory } from '../src/geometry/rapier-diagnostic-factory';
import { verifyMotion } from '../src/geometry/verify-motion';
import type { ConvexPrism } from '../src/model/geometry-model';
import { prismVertices } from '../src/model/geometry-model';
import { prismSeparation } from '../src/geometry/prism-separation';
import { searchPath } from '../src/planner/rrt-connect';

const pose = (x: number, y: number, z: number): Pose => ({
  position: { x, y, z },
  rotation: IDENTITY,
});
const interval = (
  result: { lowerBoundM: number; upperBoundM: number | null },
  expected: number,
) => {
  expect(result.lowerBoundM).toBeLessThanOrEqual(expected + 1e-12);
  expect(result.upperBoundM).not.toBeNull();
  expect(result.upperBoundM).toBeGreaterThanOrEqual(expected - 1e-12);
  expect((result.upperBoundM ?? 0) - result.lowerBoundM).toBeLessThan(0.001);
};

describe('housing-style convex physical queries', () => {
  it('covers each winder top gap, tilt and translated coordinates with independent analytical values', async () => {
    const model = createTurnFixture();
    const centers = [
      [-0.4, 0.1],
      [-0.2, 0.6],
      [0.2, 0.6],
      [0.4, 0.1],
    ] as const;
    for (const [i, center] of centers.entries()) {
      const solid = model.physicalSolids[i + 1];
      if (!solid) throw new Error('Missing winder');
      for (const offset of [-15, 0, 15]) {
        const translated = {
          ...solid,
          footprint: solid.footprint.map((p) => ({ x: p.x + offset, z: p.z })),
          bottomM: solid.bottomM + offset,
          topM: solid.topM + offset,
        };
        const dimensions = { x: 0.05, y: 0.05, z: 0.05 };
        const query = await createPhysicalQuery([translated], dimensions);
        for (const angle of [0, 0.3, 0.7]) {
          const verticalHalf =
            0.025 * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
          for (const gap of [0, 0.0001, 0.00025, 0.001, 0.12]) {
            const p = {
              ...pose(
                center[0] + offset,
                translated.topM + verticalHalf + gap,
                center[1],
              ),
              rotation: {
                x: Math.sin(angle / 2),
                y: 0,
                z: 0,
                w: Math.cos(angle / 2),
              },
            };
            const measured = query.query(p, 1);
            expect(query.queryCollision?.(p).status).toBe(measured.status);
            expect(
              measured.upperBoundM,
              JSON.stringify({ i, offset, angle, gap, p, measured }),
            ).not.toBeNull();
            interval(measured, gap);
            if (gap <= 0.0001) expect(measured.status).not.toBe('clear');
            if (gap >= 0.001) expect(measured.status).toBe('clear');
            expect(measured.obstacleId).toBe(solid.id);
          }
        }
      }
    }
  });
  it('separates packed distance, margin collision and artificial boundaries', async () => {
    const original = createTurnFixture();
    const changed = {
      ...original,
      outerConstraint: {
        id: 'constraint-wider',
        bounds: { min: { x: -2, y: -1, z: -1 }, max: { x: 2, y: 3, z: 2 } },
      },
    };
    const a = await createModelQuery(original, TURN_FIXTURE_DIMENSIONS);
    const b = await createModelQuery(changed, TURN_FIXTURE_DIMENSIONS);
    const point = pose(-0.4, 0.35, 0.02);
    const first = a.query(point, 'region-P1', 1),
      second = b.query(point, 'region-P1', 1);
    interval(a.packed.query(point, 1), 0.12);
    interval(a.clearance.query(point, 1), 0.11);
    expect(first.packed.status).toBe('clear');
    expect(first.clearance.status).toBe('clear');
    expect(first.packed).toEqual(second.packed);
    expect(a.packed.query(point, 1).obstacleId).toBe('solid-P1');
    expect(first.clearance).toEqual(second.clearance);
    const outside = pose(-0.78, 0.35, 0.02);
    expect(a.query(outside, 'region-P1', 1).virtualViolationIds).toContain(
      'constraint-outer',
    );
    expect(a.packed.query(outside, 1)).toEqual(b.packed.query(outside, 1));
    const tooClose = pose(-0.4, 0.235, 0.02);
    expect(a.packed.query(tooClose, 1).status).toBe('clear');
    expect(a.clearance.query(tooClose, 1).status).not.toBe('clear');
  });
  it('uses independent bounds rather than prediction distances for null contacts', async () => {
    const query = await createPhysicalQuery(
      createTurnFixture().physicalSolids,
      TURN_FIXTURE_DIMENSIONS.packed,
      { diagnosticFactory: createRapierDiagnosticFactory },
    );
    const far = query.query(pose(5, 5, 5), 0.1);
    expect(far.status).toBe('clear');
    expect(far.lowerBoundM).toBeGreaterThan(0.1);
    expect(far.unmeasuredSolidIds).toHaveLength(7);
    const solid = createTurnFixture().physicalSolids[1];
    if (!solid) throw new Error('Missing P1');
    const shifted = {
      ...solid,
      footprint: solid.footprint.map((p) => ({ x: p.x - 15, z: p.z })),
      bottomM: solid.bottomM - 15,
      topM: solid.topM - 15,
    };
    const single = await createPhysicalQuery(
      [shifted],
      {
        x: 0.05,
        y: 0.05,
        z: 0.05,
      },
      { diagnosticFactory: createRapierDiagnosticFactory },
    );
    const angle = 0.3;
    const near = {
      ...pose(
        -15.4,
        shifted.topM + 0.025 * (Math.cos(angle) + Math.sin(angle)) + 0.0001,
        0.1,
      ),
      rotation: { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) },
    };
    for (const prediction of [0.001, 0.1, 1]) {
      const result = single.query(near, prediction);
      interval(result, 0.0001);
      expect(result.status).toBe('unverified');
    }
    expect(single.query(near, 1).rapierRangeMismatchIds).toEqual(['solid-P1']);
    expect(() => query.query(pose(0, 0, 0), NaN)).toThrow();
  });
  it('rejects complete containment and face/edge/point contacts with closed waist geometry', async () => {
    const wall = createTurnFixture().physicalSolids.find(
      (s) => s.id === 'solid-waist',
    );
    if (!wall) throw new Error('Missing wall');
    const query = await createPhysicalQuery([wall], {
      x: 0.02,
      y: 0.02,
      z: 0.02,
    });
    for (const point of [
      pose(0, 0.5, 0),
      pose(0.06, 0.5, 0),
      pose(0.06, 0.5, 0.06),
      pose(0.06, 1.21, 0.06),
    ])
      expect(query.query(point, 0.1).status).not.toBe('clear');
    interval(query.query(pose(0.061, 0.5, 0), 0.1), 0.001);
  });
  it('detects a thin convex solid and a collision during rotation, between clear endpoints', async () => {
    const thin: ConvexPrism = {
      id: 'solid-thin',
      footprint: [
        { x: 0.2295, z: -1 },
        { x: 0.2305, z: -1 },
        { x: 0.2305, z: 1 },
        { x: 0.2295, z: 1 },
      ],
      bottomM: -1,
      topM: 1,
    };
    const model = {
      ...createTurnFixture(),
      physicalSolids: [thin],
      floorRegions: [],
      portals: [],
      outerConstraint: {
        id: 'constraint-wide',
        bounds: { min: { x: -3, y: -3, z: -3 }, max: { x: 3, y: 3, z: 3 } },
      },
    };
    const dims = {
      ...TURN_FIXTURE_DIMENSIONS,
      packed: { x: 0.1, y: 0.1, z: 0.1 },
      clearance: { x: 0.1, y: 0.1, z: 0.1 },
    };
    const query = await createModelQuery(model, dims);
    expect(
      verifyMotion(query.motionQuery, pose(-1, 0, 0), pose(1, 0, 0)).status,
    ).not.toBe('verified');
    expect(query.clearance.query(pose(0.23, 0, 0), 1).status).toBe('blocked');
    const corner: ConvexPrism = {
      id: 'solid-corner',
      footprint: [
        { x: 0.67, z: 0.67 },
        { x: 0.77, z: 0.67 },
        { x: 0.77, z: 0.77 },
        { x: 0.67, z: 0.77 },
      ],
      bottomM: -1,
      topM: 1,
    };
    const rotationQuery = await createModelQuery(
      { ...model, physicalSolids: [corner] },
      {
        ...dims,
        packed: { x: 2, y: 0.2, z: 0.2 },
        clearance: { x: 2, y: 0.2, z: 0.2 },
      },
    );
    const end = {
      ...pose(0, 0, 0),
      rotation: { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    expect(rotationQuery.clearance.query(pose(0, 0, 0), 1).status).toBe(
      'clear',
    );
    expect(rotationQuery.clearance.query(end, 1).status).toBe('clear');
    expect(
      verifyMotion(rotationQuery.motionQuery, pose(0, 0, 0), end).status,
    ).not.toBe('verified');
  });
});

describe('floor-region continuous verification', () => {
  it('cannot certify a small rotation sweep as zero when input quaternion norms are slightly high', async () => {
    const solid = {
      id: 'solid-small-sweep',
      footprint: [
        { x: 1.49, z: -0.0001 },
        { x: 1.51, z: -0.0001 },
        { x: 1.51, z: 0.0001 },
        { x: 1.49, z: 0.0001 },
      ],
      bottomM: -1,
      topM: 1,
    };
    const model = {
      id: 'scaled-rotation-fixture',
      physicalSolids: [solid],
      floorRegions: [],
      portals: [],
      outerConstraint: {
        id: 'constraint-outer',
        bounds: { min: { x: -3, y: -2, z: -1 }, max: { x: 3, y: 2, z: 1 } },
      },
    };
    const query = await createModelQuery(model, {
      ...TURN_FIXTURE_DIMENSIONS,
      packed: { x: 4, y: 0.2, z: 0.001 },
      clearance: { x: 4, y: 0.2, z: 0.001 },
    });
    const scaled = (angle: number) => ({
      ...pose(0, 0, 0),
      rotation: {
        x: 0,
        y: Math.sin(angle / 2) * 1.0000009,
        z: 0,
        w: Math.cos(angle / 2) * 1.0000009,
      },
    });
    const start = scaled(-0.0015),
      end = scaled(0.0015);
    expect(query.clearance.query(start, 1).status).toBe('clear');
    expect(query.clearance.query(end, 1).status).toBe('clear');
    expect(verifyMotion(query.motionQuery, start, end).status).not.toBe(
      'verified',
    );
  });
  it('keeps ambiguous nearest IDs null and does not certify skipped near-parallel axes', async () => {
    const wall = createTurnFixture().physicalSolids.find(
      (s) => s.id === 'solid-waist',
    );
    if (!wall) throw new Error('Missing wall');
    const solids = [-0.3, 0.3].map((offset) => ({
      ...wall,
      id: offset < 0 ? 'solid-left' : 'solid-right',
      footprint: wall.footprint.map((p) => ({ x: p.x + offset, z: p.z })),
    }));
    const query = await createPhysicalQuery(solids, { x: 0.1, y: 0.1, z: 0.1 });
    expect(query.query(pose(0, 0.5, 0), 1).obstacleId).toBeNull();
    expect(query.query(pose(0.1, 0.5, 0), 1).obstacleId).toBe('solid-right');
    const turned = {
      ...pose(0, 0.5, 0),
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    expect(
      prismSeparation(
        prismVertices(wall),
        wall.footprint,
        { x: 0.02, y: 0.02, z: 0.02 },
        turned,
      ).complete,
    ).toBe(false);
    const single = await createPhysicalQuery([wall], {
      x: 0.02,
      y: 0.02,
      z: 0.02,
    });
    expect(single.query(turned, 1).intersectingSolidIds).toEqual([]);
  });
  it('rejects uncertain planner endpoints without leaking an exception or claiming a collision', async () => {
    const query = await createModelQuery(
      createTurnFixture(),
      TURN_FIXTURE_DIMENSIONS,
    );
    const start = pose(-0.4, 0.2401, 0.02);
    expect(query.clearance.query(start, 1).status).toBe('unverified');
    expect(
      verifyModelMotion(
        query,
        { pose: start, floorRegionId: 'region-P1' },
        { pose: pose(-0.4, 0.35, 0.1), floorRegionId: 'region-P1' },
      ),
    ).toMatchObject({ status: 'unverified', reason: 'query-failed' });
    expect(
      searchPath(
        createM1CandidateQuery(query),
        { start, goal: pose(-0.4, 0.35, 0.1), guides: [] },
        { seed: 1, maxNodes: 20, maxTimeMs: 100 },
      ),
    ).toMatchObject({ status: 'path-not-found', reason: 'start-invalid' });
  });
  it('does not expand the finite portal endpoint or merge distinct close crossing events', async () => {
    const query = await createModelQuery(
      createTurnFixture(),
      TURN_FIXTURE_DIMENSIONS,
    );
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.8 - 5e-11, 0.35, 0), floorRegionId: 'region-F0' },
        { pose: pose(-0.4, 0.35, 0.02), floorRegionId: 'region-P1' },
      ).status,
    ).not.toBe('verified');
    const spans = [
      [-19, -0.000000001],
      [-0.000000001, 0.000000001],
      [0.000000001, 19],
    ] as const;
    const solids = spans.map(([min, max], i) => ({
      id: `solid-${i}`,
      footprint: [
        { x: min, z: -0.5 },
        { x: max, z: -0.5 },
        { x: max, z: 0.5 },
        { x: min, z: 0.5 },
      ],
      bottomM: -0.2,
      topM: 0,
    }));
    const model = {
      id: 'close-events-fixture',
      physicalSolids: solids,
      floorRegions: solids.map((s, i) => ({
        id: `region-${i}`,
        footprint: s.footprint,
        floorHeightM: 0,
        maxLiftM: 1,
        physicalSolidId: s.id,
      })),
      portals: [-0.000000001, 0.000000001].map((x, i) => ({
        id: `portal-${i}`,
        fromRegionId: `region-${i}`,
        toRegionId: `region-${i + 1}`,
        edge: [
          { x, z: -0.5 },
          { x, z: 0.5 },
        ] as const,
      })),
      outerConstraint: {
        id: 'constraint-outer',
        bounds: { min: { x: -20, y: -1, z: -1 }, max: { x: 20, y: 2, z: 1 } },
      },
    };
    const close = await createModelQuery(model, TURN_FIXTURE_DIMENSIONS);
    expect(
      verifyModelMotion(
        close,
        { pose: pose(-18, 0.35, 0), floorRegionId: 'region-0' },
        { pose: pose(18, 0.35, 0), floorRegionId: 'region-2' },
      ),
    ).toMatchObject({ status: 'unverified', reason: 'ambiguous-boundary' });
  });
  it('verifies a known traversal of all four winder steps', async () => {
    const query = await createModelQuery(
      createTurnFixture(),
      TURN_FIXTURE_DIMENSIONS,
    );
    for (let i = 1; i < M1_REFERENCE_STATES.length; i++) {
      const a = M1_REFERENCE_STATES[i - 1],
        b = M1_REFERENCE_STATES[i];
      if (!a || !b) throw new Error('Missing state');
      expect(verifyModelMotion(query, a, b)).toMatchObject({
        status: 'verified',
      });
    }
  });
  it('checks both portal floors, reverse movement and the actual higher physical tread', async () => {
    const query = await createModelQuery(
      createTurnFixture(),
      TURN_FIXTURE_DIMENSIONS,
    );
    const from = (y: number) => ({
      pose: pose(-0.4, y, -0.02),
      floorRegionId: 'region-F0',
    });
    const to = (y: number) => ({
      pose: pose(-0.4, y, 0.02),
      floorRegionId: 'region-P1',
    });
    expect(verifyModelMotion(query, from(0.35), to(0.35)).status).toBe(
      'verified',
    );
    expect(verifyModelMotion(query, to(0.35), from(0.35)).status).toBe(
      'verified',
    );
    expect(verifyModelMotion(query, from(0.75), to(0.75))).toMatchObject({
      status: 'blocked',
      constraintId: 'constraint-lift-region-F0',
      physicalObstacleId: null,
    });
    // Packed bottom equals the higher top but the margin box crosses that solid.
    expect(verifyModelMotion(query, from(0.23), to(0.23)).status).not.toBe(
      'verified',
    );
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.4, 0.35, 0), floorRegionId: 'region-F0' },
        to(0.35),
      ).status,
    ).toBe('verified');
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.4, 0.75, 0), floorRegionId: 'region-P1' },
        to(0.75),
      ),
    ).toMatchObject({
      status: 'blocked',
      constraintId: 'constraint-lift-region-F0',
    });
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.4, 0.35, -5e-11), floorRegionId: 'region-P1' },
        to(0.35),
      ),
    ).toMatchObject({ status: 'unverified', reason: 'ambiguous-boundary' });
  });
  it('cannot skip nonadjacent floors by passing above the waist, or switch floor at a remote edge', async () => {
    const model = createTurnFixture();
    const permissive = {
      ...model,
      floorRegions: model.floorRegions.map((r) => ({ ...r, maxLiftM: 2 })),
    };
    const query = await createModelQuery(permissive, TURN_FIXTURE_DIMENSIONS);
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.4, 1.5, -0.1), floorRegionId: 'region-F0' },
        { pose: pose(0.4, 1.5, -0.1), floorRegionId: 'region-F5' },
      ),
    ).toMatchObject({
      status: 'blocked',
      constraintId: 'constraint-floor-membership',
    });
    expect(
      verifyModelMotion(
        query,
        { pose: pose(-0.4, 0.35, -0.02), floorRegionId: 'region-F0' },
        { pose: pose(-0.4, 0.35, 0.02), floorRegionId: 'region-P2' },
      ).status,
    ).toBe('blocked');
  });
  it('rejects rotation that exceeds lifting limits only between valid endpoints', async () => {
    const model = createTurnFixture();
    const query = await createModelQuery(
      {
        ...model,
        floorRegions: model.floorRegions.map((r) =>
          r.id === 'region-F0' ? { ...r, maxLiftM: 0.07 } : r,
        ),
      },
      TURN_FIXTURE_DIMENSIONS,
    );
    const angle = Math.PI / 4;
    const start = {
      pose: {
        ...pose(-0.4, 0.13, -0.1),
        rotation: {
          x: 0,
          y: 0,
          z: -Math.sin(angle / 2),
          w: Math.cos(angle / 2),
        },
      },
      floorRegionId: 'region-F0',
    };
    const end = {
      ...start,
      pose: {
        ...start.pose,
        rotation: { ...start.pose.rotation, z: Math.sin(angle / 2) },
      },
    };
    expect(
      query.query(start.pose, start.floorRegionId, 1).virtualViolationIds,
    ).toEqual([]);
    expect(
      query.query(end.pose, end.floorRegionId, 1).virtualViolationIds,
    ).toEqual([]);
    expect(verifyModelMotion(query, start, end)).toMatchObject({
      status: 'blocked',
      constraintId: 'constraint-lift-region-F0',
    });
  });
  it('fails closed for ambiguous boundary following, exhausted budget and failed queries', async () => {
    const query = await createModelQuery(
      createTurnFixture(),
      TURN_FIXTURE_DIMENSIONS,
    );
    const start = { pose: pose(-0.4, 0.35, 0), floorRegionId: 'region-F0' },
      end = { pose: pose(-0.3, 0.35, 0), floorRegionId: 'region-F0' };
    expect(verifyModelMotion(query, start, end)).toMatchObject({
      status: 'unverified',
      reason: 'ambiguous-boundary',
    });
    const a = M1_REFERENCE_STATES[0],
      b = M1_REFERENCE_STATES[1];
    if (!a || !b) throw new Error('Missing state');
    expect(
      verifyModelMotion(query, a, b, { maxDepth: 0, maxQueries: 1 }),
    ).toMatchObject({ status: 'unverified', reason: 'budget' });
    expect(
      verifyModelMotion(
        {
          ...query,
          motionQuery: {
            ...query.motionQuery,
            query: () => {
              throw new Error('API failure');
            },
          },
        },
        a,
        b,
      ),
    ).toMatchObject({ status: 'unverified', reason: 'query-failed' });
  });
  it('runs the dedicated benchmark without claiming a target-home route', async () => {
    const benchmark = await prepareM1Benchmark();
    const result = benchmark.run();
    expect(result.referenceMotion.every((r) => r.status === 'verified')).toBe(
      true,
    );
    expect(result.search.scope).toBe('physical-and-outer-candidate-only');
    expect(result.fixtureId).toBe('fixture-m0-turn-v1');
    expect(result.precisionProbe.result).toMatchObject({
      diagnosticsEnabled: true,
      status: 'unverified',
      rapierRangeMismatchIds: ['solid-P1'],
    });
    expect(result.distanceRefinementProbes.map((p) => p.id)).toEqual([
      'distance-corner-v1',
      'distance-edge-v1',
      'distance-thin-v1',
    ]);
    for (const probe of result.distanceRefinementProbes) {
      expect(probe.result.diagnosticsEnabled).toBe(true);
      interval(probe.result, probe.expectedM);
    }
  });
});
