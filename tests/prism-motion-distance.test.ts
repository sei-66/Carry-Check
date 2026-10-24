import { describe, expect, it } from 'vitest';
import { IDENTITY, type Pose } from '../src/domain/pose';
import { createPhysicalQuery } from '../src/geometry/physical-query';
import { evaluatePathClearance } from '../src/geometry/path-clearance';
import type { ConvexPrism } from '../src/model/geometry-model';

const pose = (x: number, y: number): Pose => ({
  position: { x, y, z: 0 },
  rotation: IDENTITY,
});
const wall: ConvexPrism = {
  id: 'wall',
  footprint: [
    { x: 2, z: -5 },
    { x: 2.2, z: -5 },
    { x: 2.2, z: 5 },
    { x: 2, z: 5 },
  ],
  bottomM: -5,
  topM: 5,
};
describe('whole sweep independent physical projection', () => {
  it('retains a plane gap during long translation parallel to a floor', async () => {
    const floor: ConvexPrism = {
      id: 'floor',
      footprint: [
        { x: -5, z: -5 },
        { x: 5, z: -5 },
        { x: 5, z: 5 },
        { x: -5, z: 5 },
      ],
      bottomM: -0.2,
      topM: 0,
    };
    const query = await createPhysicalQuery([floor], {
      x: 0.2,
      y: 0.2,
      z: 0.2,
    });
    const first = pose(-2, 0.7),
      last = pose(2, 0.7);
    const lower = query.sweepLowerBound?.(first, last);
    expect(lower).toBeLessThanOrEqual(0.6);
    expect(lower).toBeGreaterThan(0.5997);
    const result = evaluatePathClearance(query, [first, last], {
      maxQueries: 10,
      maxTimeMs: 1000,
    });
    expect(result.queries).toBe(3);
    expect(result.clearance?.lowerBoundM).toBeLessThanOrEqual(0.6);
    expect(result.clearance?.upperBoundM).toBeGreaterThanOrEqual(0.6);
  });
  it('encloses the unsampled rotational support maximum and evaluates it to 1mm', async () => {
    const query = await createPhysicalQuery([wall], { x: 1, y: 0.2, z: 0.2 });
    const first = {
      ...pose(0, 0),
      rotation: { x: 0, y: 0, z: Math.sin(-0.1 / 2), w: Math.cos(-0.1 / 2) },
    };
    const last = {
      ...pose(0, 0),
      rotation: { x: 0, y: 0, z: Math.sin(0.7 / 2), w: Math.cos(0.7 / 2) },
    };
    const exact = 2 - Math.hypot(0.5, 0.1);
    expect(query.sweepLowerBound?.(first, last)).toBeLessThanOrEqual(exact);
    const result = evaluatePathClearance(query, [first, last], {
      maxQueries: 1000,
      maxTimeMs: 1000,
    });
    expect(result.clearance?.lowerBoundM).toBeLessThanOrEqual(exact);
    expect(result.clearance?.upperBoundM).toBeGreaterThanOrEqual(exact);
    expect(
      (result.clearance?.upperBoundM ?? Infinity) -
        (result.clearance?.lowerBoundM ?? 0),
    ).toBeLessThanOrEqual(0.001);
  });
  it('counts sweep projections in the shared query budget', async () => {
    const query = await createPhysicalQuery([wall], { x: 0.2, y: 0.2, z: 0.2 });
    expect(
      evaluatePathClearance(query, [pose(0, 0), pose(0.5, 0)], {
        maxQueries: 2,
        maxTimeMs: 1000,
      }),
    ).toEqual({ clearance: null, queries: 2 });
  });
});
