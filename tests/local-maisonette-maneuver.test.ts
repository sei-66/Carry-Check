import { beforeAll, expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import { rotateVector, rotationAngle } from '../src/domain/pose';
import {
  verifyModelMotion,
  type FloorState,
} from '../src/geometry/floor-motion';
import { createModelQuery, type ModelQuery } from '../src/geometry/model-query';
import { createMaisonetteModel } from '../src/model/maisonette-model';
import { searchLocalMaisonetteManeuver } from '../src/planner/local-maisonette-maneuver';

const house = createMaisonetteModel();
let query: ModelQuery;
let start: FloorState;
const goalRotation = { x: 0, y: 0, z: 0, w: 1 };
beforeAll(async () => {
  const dimensions = validateInputSnapshot({
    widthMm: 500,
    depthMm: 500,
    heightMm: 1400,
    marginMm: 10,
  });
  if (!dimensions.ok) throw new Error('Invalid fixture dimensions');
  query = await createModelQuery(house.geometry, dimensions.value);
  const guide = house.guide.find(
    (point) => point.floorRegionId === 'region-step-012',
  );
  if (!guide) throw new Error('Missing turn floor');
  start = {
    floorRegionId: guide.floorRegionId,
    pose: {
      position: {
        ...guide.positionXZ,
        y: guide.floorHeightM + 0.3 + dimensions.value.packed.y / 2,
      },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    },
  };
});

it('discovers a compound turn from a v3 stair guide within a shared finite budget', () => {
  // The positive case must need more than an upright quarter-turn in place.
  expect(
    verifyModelMotion(query, start, {
      ...start,
      pose: { ...start.pose, rotation: goalRotation },
    }).status,
  ).not.toBe('verified');
  let nodes = 0;
  let queries = 0;
  const path = searchLocalMaisonetteManeuver({
    query,
    house,
    start,
    goalRotation,
    shouldStop: () => nodes >= 5000 || queries >= 50000,
    validateState: (state) => {
      if (nodes >= 5000 || queries + 2 > 50000) return 'stopped';
      nodes++;
      queries += 2;
      const result = query.query(state.pose, state.floorRegionId, 1);
      return result.packed.status === 'clear' &&
        result.clearance.status === 'clear' &&
        !result.virtualViolationIds.length
        ? 'valid'
        : 'invalid';
    },
    verifyEdge: (a, b, budget) => {
      if (queries >= 50000) return 'unverified';
      const result = verifyModelMotion(query, a, b, {
        maxDepth: 18,
        maxQueries: Math.min(budget, 50000 - queries),
      });
      queries += result.queries;
      return result.status;
    },
  });
  expect(path).not.toBeNull();
  expect(nodes).toBeLessThanOrEqual(5000);
  expect(queries).toBeLessThanOrEqual(50000);
  if (!path) throw new Error('Missing turn');
  expect(path[0]).toEqual(start);
  expect(rotationAngle(path.at(-1)!.pose.rotation, goalRotation)).toBeLessThan(
    1e-7,
  );
  expect(
    path.some(
      (state) =>
        rotateVector({ x: 0, y: 1, z: 0 }, state.pose.rotation).y < 0.999,
    ),
  ).toBe(true);
  for (const [index, state] of path.entries()) {
    expect(state.floorRegionId).toBe(start.floorRegionId);
    expect(query.query(state.pose, state.floorRegionId, 1)).toMatchObject({
      packed: { status: 'clear' },
      clearance: { status: 'clear' },
      virtualViolationIds: [],
    });
    if (index)
      expect(verifyModelMotion(query, path[index - 1]!, state)).toMatchObject({
        status: 'verified',
      });
  }
});

it('never returns an unverified connection and honors a stop raised by the edge callback', () => {
  let stopped = false;
  let edges = 0;
  expect(
    searchLocalMaisonetteManeuver({
      query,
      house,
      start,
      goalRotation,
      shouldStop: () => stopped,
      validateState: () => (stopped ? 'stopped' : 'valid'),
      verifyEdge: () => {
        edges++;
        stopped = true;
        return 'unverified';
      },
    }),
  ).toBeNull();
  expect(edges).toBe(1);
});

it('does not query geometry after an initial cancellation', () => {
  let calls = 0;
  expect(
    searchLocalMaisonetteManeuver({
      query,
      house,
      start,
      goalRotation,
      shouldStop: () => true,
      validateState: () => {
        calls++;
        return 'valid';
      },
      verifyEdge: () => {
        calls++;
        return 'verified';
      },
    }),
  ).toBeNull();
  expect(calls).toBe(0);
});
