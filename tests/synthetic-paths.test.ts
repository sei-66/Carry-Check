import { describe, expect, it } from 'vitest';
import { validateDimensions } from '../src/domain/dimensions';
import { createPoseQuery } from '../src/geometry/rapier-query';
import { verifyMotion, verifyPath } from '../src/geometry/verify-motion';
import {
  createSyntheticScenario,
  SYNTHETIC_SCENARIO_FIXTURES,
} from './fixtures/synthetic-scenarios';

describe('synthetic geometry regression fixtures', () => {
  it.each(SYNTHETIC_SCENARIO_FIXTURES)(
    '$id dimensions and margin fit a known valid route',
    async (fixture) => {
      const input = validateDimensions(fixture.input);
      if (!input.ok)
        throw new Error('Fixture must pass the shared input validation');
      const scenario = createSyntheticScenario(fixture.id);
      const query = await createPoseQuery(
        scenario.scene,
        input.value.clearance,
      );
      const { start, goal } = scenario.problem;
      // Independent route: turn 90 degrees in open space, cross the aperture,
      // and return to upright. This does not use the planner's output or guides.
      const rotation =
        fixture.id === 'rotate'
          ? { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
          : { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
      const knownPath =
        fixture.id === 'straight'
          ? [start, goal]
          : [
              start,
              { position: { x: 0, y: 2, z: -1.5 }, rotation },
              { position: { x: 0, y: 2, z: 1.5 }, rotation },
              goal,
            ];
      expect(verifyPath(query, knownPath).status).toBe('verified');
      expect(verifyMotion(query, start, goal).status).toBe(
        fixture.id === 'straight' ? 'verified' : 'blocked',
      );
    },
  );
});
