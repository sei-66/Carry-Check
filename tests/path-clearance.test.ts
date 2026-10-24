import { describe, expect, it } from 'vitest';
import { IDENTITY, type Pose } from '../src/domain/pose';
import type { PhysicalQuery } from '../src/geometry/physical-query';
import { evaluatePathClearance } from '../src/geometry/path-clearance';

const pose = (x: number, y = 0): Pose => ({
  position: { x, y, z: 0 },
  rotation: IDENTITY,
});
function query(distance: (p: Pose) => number): PhysicalQuery {
  return {
    radius: 0.5,
    query(p) {
      const value = distance(p);
      return {
        status: 'clear',
        lowerBoundM: value - 0.00025,
        upperBoundM: value + 0.00025,
        obstacleId: 'wall',
        limitingSolidId: 'wall',
        intersectingSolidIds: [],
        diagnosticsEnabled: false,
        unmeasuredSolidIds: [],
        rapierRangeMismatchIds: [],
        rapierDistanceMismatchIds: [],
        rapierUnavailableSolidIds: [],
        rapierQueryFailureIds: [],
      };
    },
  };
}
describe('continuous physical path minimum', () => {
  it.each(['sample', 'sweep'] as const)(
    'does not publish a bound when the final synchronous %s crosses its deadline',
    (operation) => {
      let now = 0;
      const base = query(() => 0.5);
      const slow: PhysicalQuery = {
        ...base,
        query(p, prediction) {
          const result = base.query(p, prediction);
          if (operation === 'sample') now += 6;
          return result;
        },
        sweepLowerBound() {
          if (operation === 'sweep') now = 10;
          return 0.49975;
        },
      };
      const result = evaluatePathClearance(slow, [pose(0), pose(1)], {
        maxQueries: 100,
        maxTimeMs: 10,
        clock: () => now,
      });
      expect(result.clearance).toBeNull();
      expect(result.queries).toBe(operation === 'sample' ? 2 : 3);
    },
  );
  it('bounds a rotation minimum between keyframes using the moving box radius', () => {
    const rotationPose = (angle: number): Pose => ({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
    });
    const physical = query((p) => {
      const a = 2 * Math.atan2(p.rotation.z, p.rotation.w);
      return 2 - (0.5 * Math.abs(Math.cos(a)) + 0.1 * Math.abs(Math.sin(a)));
    });
    const result = evaluatePathClearance(
      { ...physical, radius: Math.hypot(0.5, 0.1) },
      [rotationPose(-0.1), rotationPose(0.7)],
      { maxQueries: 1000, maxTimeMs: 1000 },
    );
    const exact = 2 - Math.hypot(0.5, 0.1);
    expect(result.clearance?.lowerBoundM).toBeLessThanOrEqual(exact);
    expect(result.clearance?.upperBoundM).toBeGreaterThanOrEqual(exact);
    expect(
      (result.clearance?.upperBoundM ?? Infinity) -
        (result.clearance?.lowerBoundM ?? 0),
    ).toBeLessThanOrEqual(0.001);
  });
  it('includes a minimum between stored poses rather than reporting the endpoints', () => {
    // Distance from a translating point to a fixed origin offset by .02m.
    const result = evaluatePathClearance(
      query((p) => Math.hypot(p.position.x, 0.02)),
      [pose(-1), pose(1)],
      { maxQueries: 10000, maxTimeMs: 1000 },
    );
    expect(result.clearance?.lowerBoundM).toBeLessThanOrEqual(0.02);
    expect(result.clearance?.upperBoundM).toBeGreaterThanOrEqual(0.02);
    expect(
      (result.clearance?.upperBoundM ?? Infinity) -
        (result.clearance?.lowerBoundM ?? 0),
    ).toBeLessThanOrEqual(0.001);
  });
  it('finds the global minimum in the final segment and does not certify the sampled solid as globally nearest', () => {
    const result = evaluatePathClearance(
      query((p) => Math.hypot(p.position.x, 0.025)),
      [pose(3), pose(2), pose(-1)],
      { maxQueries: 10000, maxTimeMs: 1000 },
    );
    expect(result.clearance?.lowerBoundM).toBeLessThanOrEqual(0.025);
    expect(result.clearance?.upperBoundM).toBeGreaterThanOrEqual(0.025);
    expect(result.clearance?.obstacleId).toBeNull();
    expect(result.clearance?.attention.segmentIndex).toBe(1);
    expect(
      Math.abs(result.clearance?.attention.pose.position.x ?? Infinity),
    ).toBeLessThan(0.01);
  });
  it('keeps incomplete evaluation null at a strict query or time limit', () => {
    expect(
      evaluatePathClearance(
        query(() => 0.5),
        [pose(0), pose(1)],
        { maxQueries: 2, maxTimeMs: 1000 },
      ),
    ).toEqual({ clearance: null, queries: 2 });
    expect(
      evaluatePathClearance(
        query(() => 0.5),
        [pose(0), pose(1)],
        { maxQueries: 100, maxTimeMs: 0 },
      ),
    ).toEqual({ clearance: null, queries: 0 });
  });
});
