import { describe, expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import { IDENTITY, type Pose } from '../src/domain/pose';
import { createModelQuery } from '../src/geometry/model-query';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import { verifyMotion } from '../src/geometry/verify-motion';
import type { GeometryModel } from '../src/model/geometry-model';

const floor = [
  { x: -3, z: -2 },
  { x: 3, z: -2 },
  { x: 3, z: 2 },
  { x: -3, z: 2 },
] as const;
const model: GeometryModel = {
  id: 'sweep-floor',
  physicalSolids: [{ id: 'floor', footprint: floor, bottomM: -0.2, topM: 0 }],
  floorRegions: [
    {
      id: 'region',
      footprint: floor,
      floorHeightM: 0,
      maxLiftM: 0.72,
      physicalSolidId: 'floor',
    },
  ],
  portals: [],
  outerConstraint: {
    id: 'outer',
    bounds: { min: { x: -3, y: -0.2, z: -2 }, max: { x: 3, y: 3, z: 2 } },
  },
};
const pose = (x: number): Pose => ({
  position: { x, y: 0.75, z: 0 },
  rotation: IDENTITY,
});
async function query() {
  const dimensions = validateInputSnapshot({
    widthMm: 600,
    depthMm: 700,
    heightMm: 1000,
    marginMm: 10,
  });
  if (!dimensions.ok) throw new Error('Invalid dimensions');
  return createModelQuery(model, dimensions.value);
}

describe('conservative sweep collision proof', () => {
  it('verifies a long constant floor gap without distance-based subdivision', async () => {
    const physical = await query();
    const a = pose(-2),
      b = pose(2);
    const result = verifyModelMotion(
      physical,
      { pose: a, floorRegionId: 'region' },
      { pose: b, floorRegionId: 'region' },
      { maxQueries: 5, maxDepth: 0 },
    );
    expect(result).toMatchObject({ status: 'verified', queries: 5 });
    expect(physical.packed.query(a, 100).upperBoundM).toBeGreaterThan(0.249);
    const withoutSweep = {
      radius: physical.motionQuery.radius,
      bounds: physical.motionQuery.bounds,
      query: (p: Pose, predictionM: number) =>
        physical.motionQuery.query(p, predictionM),
    };
    expect(
      verifyMotion(withoutSweep, a, b, { maxQueries: 3, maxDepth: 0 }).status,
    ).toBe('unverified');
  });

  it('counts the sweep against the query budget and handles failed bounds conservatively', async () => {
    const physical = await query();
    expect(
      verifyMotion(physical.motionQuery, pose(-2), pose(2), {
        maxQueries: 2,
        maxDepth: 0,
      }),
    ).toMatchObject({ status: 'unverified', queries: 2, reason: 'budget' });
    for (const sweepLowerBound of [
      () => NaN,
      () => {
        throw new Error('Sweep failure');
      },
    ])
      expect(
        verifyMotion(
          { ...physical.motionQuery, sweepLowerBound },
          pose(-2),
          pose(2),
        ),
      ).toMatchObject({ status: 'unverified', reason: 'query-failed' });
  });

  it('bounds lifting during a tilted horizontal move without treating horizontal distance as lift', async () => {
    const physical = await query();
    const a = pose(-2);
    const b: Pose = {
      ...pose(2),
      rotation: { x: 0, y: Math.sin(0.01), z: 0, w: Math.cos(0.01) },
    };
    expect(
      verifyModelMotion(
        physical,
        { pose: a, floorRegionId: 'region' },
        { pose: b, floorRegionId: 'region' },
        { maxQueries: 5, maxDepth: 0 },
      ),
    ).toMatchObject({ status: 'verified', queries: 5 });
  });

  it('rejects a rotation that leaves the artificial outer bound between clear endpoints', async () => {
    const dimensions = validateInputSnapshot({
      widthMm: 2000,
      depthMm: 200,
      heightMm: 200,
      marginMm: 10,
    });
    if (!dimensions.ok) throw new Error('Invalid dimensions');
    const physical = await createModelQuery(
      {
        ...model,
        outerConstraint: {
          id: 'outer',
          bounds: {
            min: { x: -1.006, y: -1, z: -3 },
            max: { x: 1.006, y: 3, z: 3 },
          },
        },
      },
      dimensions.value,
    );
    const turn = (angle: number): Pose => ({
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
    });
    const a = turn(-0.6),
      b = turn(0.6);
    expect(physical.motionQuery.query(a, 1).status).toBe('clear');
    expect(physical.motionQuery.query(b, 1).status).toBe('clear');
    expect(verifyMotion(physical.motionQuery, a, b).status).not.toBe(
      'verified',
    );
  });
});
