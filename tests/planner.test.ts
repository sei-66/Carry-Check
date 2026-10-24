import { describe, expect, it } from 'vitest';
import { rotationAngle } from '../src/domain/pose';
import { createPoseQuery } from '../src/geometry/rapier-query';
import { verifyMotion, verifyPath } from '../src/geometry/verify-motion';
import { searchPath, seededRandom } from '../src/planner/rrt-connect';
import { createSyntheticScenario } from './fixtures/synthetic-scenarios';

const options = { seed: 20260930, maxNodes: 5000, maxTimeMs: 10000 };

describe('seeded six-degree-of-freedom prototype', () => {
  it('finds and revalidates a straight path', async () => {
    const scenario = createSyntheticScenario('straight');
    const query = await createPoseQuery(scenario.scene, {
      x: 0.6,
      y: 1.2,
      z: 0.8,
    });
    const result = searchPath(query, scenario.problem, options);
    expect(result.status).toBe('path-found');
    if (result.status === 'path-found')
      expect(verifyPath(query, result.poses).status).toBe('verified');
  });
  it.each(['rotate', 'tilt'] as const)(
    'finds a %s-required path with reproducible poses and revalidates every interval',
    async (id) => {
      const scenario = createSyntheticScenario(id);
      const dimensions =
        id === 'rotate'
          ? { x: 1.2, y: 0.4, z: 0.4 }
          : { x: 0.4, y: 1.2, z: 0.4 };
      const query = await createPoseQuery(scenario.scene, dimensions);
      // Upright straight translation cannot fit through the known 0.8m aperture.
      expect(
        verifyMotion(query, scenario.problem.start, scenario.problem.goal)
          .status,
      ).toBe('blocked');
      // Independent hand-constructed solution: rotate in open space, cross, rotate back.
      const guideStart = scenario.problem.guides[0];
      const guideEnd = scenario.problem.guides.at(-1);
      expect(guideStart).toBeDefined();
      expect(guideEnd).toBeDefined();
      if (!guideStart || !guideEnd) throw new Error('Missing fixture');
      expect(
        verifyPath(query, [
          scenario.problem.start,
          guideStart,
          guideEnd,
          scenario.problem.goal,
        ]).status,
      ).toBe('verified');
      const first = searchPath(query, scenario.problem, options);
      const second = searchPath(query, scenario.problem, options);
      expect(first.status).toBe('path-found');
      if (first.status !== 'path-found' || second.status !== 'path-found')
        throw new Error(JSON.stringify({ first, second }));
      expect(first.poses).toEqual(second.poses);
      expect(first.poses[0]).toEqual(scenario.problem.start);
      expect(
        rotationAngle(
          first.poses.at(-1)?.rotation ?? scenario.problem.start.rotation,
          scenario.problem.goal.rotation,
        ),
      ).toBeCloseTo(0);
      expect(verifyPath(query, first.poses).status).toBe('verified');
      expect(
        first.poses.some(
          (pose) =>
            rotationAngle(pose.rotation, scenario.problem.start.rotation) > 0.3,
        ),
      ).toBe(true);
    },
  );
  it('returns reasoned failures for budgets and invalid endpoint placement', async () => {
    const scenario = createSyntheticScenario('rotate');
    const query = await createPoseQuery(scenario.scene, {
      x: 1.2,
      y: 0.4,
      z: 0.4,
    });
    expect(
      searchPath(query, scenario.problem, { ...options, maxNodes: 2 }),
    ).toMatchObject({ status: 'path-not-found', reason: 'node-limit' });
    const invalid = await createPoseQuery(scenario.scene, { x: 5, y: 5, z: 5 });
    expect(searchPath(invalid, scenario.problem, options)).toMatchObject({
      status: 'path-not-found',
      reason: 'start-invalid',
    });
    let time = 0;
    expect(
      searchPath(
        query,
        scenario.problem,
        { ...options, maxTimeMs: 1 },
        () => {},
        () => time++,
      ),
    ).toMatchObject({ status: 'path-not-found', reason: 'time-limit' });
    const a = seededRandom(123);
    const b = seededRandom(123);
    expect(Array.from({ length: 10 }, a)).toEqual(
      Array.from({ length: 10 }, b),
    );
  });
});
