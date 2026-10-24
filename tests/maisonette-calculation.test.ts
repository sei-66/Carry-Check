import { describe, expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import {
  distance,
  halfExtents,
  interpolatePose,
  rotationAngle,
} from '../src/domain/pose';
import { createModelQuery } from '../src/geometry/model-query';
import { createMaisonetteModel } from '../src/model/maisonette-model';
import { runMaisonetteCalculation } from '../src/workers/run-maisonette-calculation';
import { FIXED_ROUTE } from '../src/shared/fixed-route';

describe('fixed assumed house calculation', () => {
  it('returns a verified full route, bounded physical clearance and a reproducible representative pose', async () => {
    const house = createMaisonetteModel();
    expect(house.metadata.modelVersion).toBe(FIXED_ROUTE.modelVersion);
    const input = validateInputSnapshot({
      widthMm: 120,
      depthMm: 180,
      heightMm: 140,
      marginMm: 10,
    });
    if (!input.ok) throw new Error('Invalid fixture input');
    const query = await createModelQuery(house.geometry, input.value);
    const result = runMaisonetteCalculation(
      query,
      house,
      { seed: 20261004, maxNodes: 5000, maxTimeMs: 10000 },
      () => {},
    );
    expect(result.status).toBe('path-found');
    if (result.status !== 'path-found') throw new Error(result.reason);
    expect(result.floorRegionIds).toHaveLength(result.poses.length);
    expect(result.floorRegionIds.at(-1)).toBe(house.goalRegionId);
    const approach = result.poses.at(-2),
      goal = result.poses.at(-1);
    if (!approach || !goal) throw new Error('Missing opening crossing');
    const opening = house.openings.ldk;
    const half = halfExtents(input.value.clearance, goal.rotation);
    const normalSupport =
      Math.abs(opening.normal.x) * half.x +
      Math.abs(opening.normal.y) * half.y +
      Math.abs(opening.normal.z) * half.z;
    const project = (p: typeof goal) =>
      opening.normal.x * p.position.x +
      opening.normal.y * p.position.y +
      opening.normal.z * p.position.z;
    expect(project(approach) + normalSupport).toBeLessThanOrEqual(
      opening.approachPlaneM - opening.epsilonM + 1e-10,
    );
    expect(project(goal) - normalSupport).toBeGreaterThanOrEqual(
      opening.departurePlaneM + opening.epsilonM - 1e-10,
    );
    expect(rotationAngle(approach.rotation, goal.rotation)).toBeLessThan(1e-10);
    expect(goal.position.y).toBe(approach.position.y);
    if (opening.widthAxis === 'z')
      expect(goal.position.z).toBe(approach.position.z);
    else expect(goal.position.x).toBe(approach.position.x);
    expect(result.clearance).not.toBeNull();
    if (!result.clearance)
      throw new Error('Small route clearance not completed');
    expect(
      result.clearance.upperBoundM - result.clearance.lowerBoundM,
    ).toBeLessThanOrEqual(0.0008);
    expect(result.clearance.lowerBoundM).toBeGreaterThan(0);
    const representative = result.clearance.attention;
    const first = result.poses[representative.segmentIndex],
      last = result.poses[representative.segmentIndex + 1];
    if (!first || !last) throw new Error('Missing attention segment');
    const expected = interpolatePose(first, last, representative.fraction);
    expect(
      distance(expected.position, representative.pose.position),
    ).toBeLessThan(1e-8);
    expect(
      rotationAngle(expected.rotation, representative.pose.rotation),
    ).toBeLessThan(1e-8);
    if (representative.obstacleId)
      expect(
        house.geometry.physicalSolids.some(
          (s) => s.id === representative.obstacleId,
        ),
      ).toBe(true);
    const observed = query.packed.query(representative.pose, 100);
    expect(observed.lowerBoundM).toBeGreaterThanOrEqual(
      result.clearance.lowerBoundM - 1e-8,
    );
    expect(observed.upperBoundM).toBeLessThanOrEqual(
      result.clearance.upperBoundM + 1e-8,
    );
  }, 20_000);
});
