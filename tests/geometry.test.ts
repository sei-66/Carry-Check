import { describe, expect, it } from 'vitest';
import { IDENTITY, type Pose } from '../src/domain/pose';
import {
  createPoseQuery,
  NUMERICAL_ERROR_M,
} from '../src/geometry/rapier-query';
import type { GeometryScene } from '../src/geometry/scene';
import { verifyMotion, verifyPath } from '../src/geometry/verify-motion';

const bounds = {
  min: { x: -10, y: -10, z: -10 },
  max: { x: 10, y: 10, z: 10 },
};
const pose = (x = 0, y = 0, z = 0): Pose => ({
  position: { x, y, z },
  rotation: IDENTITY,
});
const scene: GeometryScene = {
  bounds,
  obstacles: [
    {
      id: 'solid',
      pose: pose(),
      shape: { kind: 'cuboid', dimensions: { x: 2, y: 2, z: 2 } },
    },
  ],
};

describe('solid contact and conservative distance', () => {
  it('distinguishes separation, intersection and complete containment', async () => {
    const query = await createPoseQuery(scene, { x: 1, y: 1, z: 1 });
    const gap = query.query(pose(2), 1);
    expect(gap.lowerBoundM).toBeCloseTo(0.5 - NUMERICAL_ERROR_M, 5);
    expect(gap.upperBoundM).toBeCloseTo(0.5 + NUMERICAL_ERROR_M, 5);
    expect(query.query(pose(1), 1).status).toBe('blocked');
    expect(query.query(pose(), 1).status).toBe('blocked');
  });
  it.each([
    [1.5, 0, 0],
    [1.5, 1.5, 0],
    [1.5, 1.5, 1.5],
  ])('rejects face/edge/point contact %j', async (x, y, z) => {
    const query = await createPoseQuery(scene, { x: 1, y: 1, z: 1 });
    expect(query.query(pose(x, y, z), 0.01).status).toBe('blocked');
  });
  it('uses out-of-range null as a lower bound, and rejects numerical boundaries', async () => {
    const query = await createPoseQuery(scene, { x: 1, y: 1, z: 1 });
    expect(query.query(pose(4), 0.2).lowerBoundM).toBeCloseTo(
      0.2 - NUMERICAL_ERROR_M,
    );
    expect(query.query(pose(1.5001), 0.01).status).toBe('blocked');
    expect(query.query(pose(1.501), 0.01).status).toBe('clear');
    expect(() => query.query(pose(), NaN)).toThrow();
  });
  it('validates convex prisms as solids including containment', async () => {
    const vertices = [-1, 1].flatMap((y) => [
      { x: -1, y, z: -1 },
      { x: 1, y, z: -1 },
      { x: 0, y, z: 1 },
    ]);
    const query = await createPoseQuery(
      {
        bounds,
        obstacles: [
          { id: 'prism', pose: pose(), shape: { kind: 'convex', vertices } },
        ],
      },
      { x: 0.1, y: 0.1, z: 0.1 },
    );
    expect(query.query(pose(), 1).status).toBe('blocked');
    expect(query.query(pose(3), 1).status).toBe('clear');
    await expect(
      createPoseQuery(
        {
          bounds,
          obstacles: [
            {
              id: 'flat',
              pose: pose(),
              shape: { kind: 'convex', vertices: [{ x: 0, y: 0, z: 0 }] },
            },
          ],
        },
        { x: 1, y: 1, z: 1 },
      ),
    ).rejects.toThrow();
  });
  it('rejects exactly filled 800mm opening and larger margins', async () => {
    const opening: GeometryScene = {
      bounds: { min: { x: -0.4, y: -1, z: -1 }, max: { x: 0.4, y: 1, z: 1 } },
      obstacles: [],
    };
    for (const margin of [0, 0.01, 0.02]) {
      const query = await createPoseQuery(opening, {
        x: 0.78 + 2 * margin,
        y: 0.2,
        z: 0.2,
      });
      expect(query.query(pose(), 1).status).toBe(
        margin === 0 ? 'clear' : 'blocked',
      );
    }
  });
  it('uses a unit obstacle rotation within the accepted norm tolerance and rejects invalid norms', async () => {
    const rotation = {
      x: 0,
      y: Math.SQRT1_2,
      z: 0,
      w: Math.SQRT1_2,
    };
    const rotatedScene = (scale: number): GeometryScene => ({
      bounds,
      obstacles: [
        {
          id: 'rotated',
          pose: {
            position: { x: 0, y: 0, z: 0 },
            rotation: {
              x: 0,
              y: rotation.y * scale,
              z: 0,
              w: rotation.w * scale,
            },
          },
          shape: { kind: 'cuboid', dimensions: { x: 4, y: 2, z: 0.4 } },
        },
      ],
    });
    const dimensions = { x: 1, y: 1, z: 1 };
    for (const scale of [1, 1.0000009]) {
      const query = await createPoseQuery(rotatedScene(scale), dimensions);
      const result = query.query(pose(2.2), 2);
      // A 90-degree turn makes the obstacle's X half-extent 0.2 m.
      expect(result.lowerBoundM).toBeCloseTo(1.5 - NUMERICAL_ERROR_M, 8);
      expect(result.upperBoundM).toBeCloseTo(1.5 + NUMERICAL_ERROR_M, 8);
    }
    await expect(
      createPoseQuery(rotatedScene(2), dimensions),
    ).rejects.toThrow();
  });
});

describe('continuous motion verification', () => {
  it('rejects crossing a thin wall between clear endpoints', async () => {
    const query = await createPoseQuery(
      {
        bounds,
        obstacles: [
          {
            id: 'thin',
            pose: pose(0.23),
            shape: { kind: 'cuboid', dimensions: { x: 0.001, y: 4, z: 4 } },
          },
        ],
      },
      { x: 0.1, y: 0.1, z: 0.1 },
    );
    expect(query.query(pose(-1), 1).status).toBe('clear');
    expect(query.query(pose(1), 1).status).toBe('clear');
    expect(verifyMotion(query, pose(-1), pose(1)).status).toBe('blocked');
  });
  it('rejects a corner collision during rotation with clear endpoints', async () => {
    const query = await createPoseQuery(
      {
        bounds,
        obstacles: [
          {
            id: 'corner',
            pose: pose(0.72, 0, 0.72),
            shape: { kind: 'cuboid', dimensions: { x: 0.1, y: 1, z: 0.1 } },
          },
        ],
      },
      { x: 2, y: 0.2, z: 0.2 },
    );
    const end = {
      ...pose(),
      rotation: { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    expect(query.query(pose(), 1).status).toBe('clear');
    expect(query.query(end, 1).status).toBe('clear');
    expect(verifyMotion(query, pose(), end).status).toBe('blocked');
  });
  it('checks box containment throughout rotation, and does not accept budget/API failure', async () => {
    const query = await createPoseQuery(
      {
        bounds: {
          min: { x: -1.01, y: -2, z: -1.01 },
          max: { x: 1.01, y: 2, z: 1.01 },
        },
        obstacles: [],
      },
      { x: 2, y: 0.2, z: 0.8 },
    );
    const end = {
      ...pose(),
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    };
    expect(verifyMotion(query, pose(), end).status).toBe('blocked');
    expect(
      verifyMotion(query, pose(), end, { maxDepth: 0, maxQueries: 2 }).status,
    ).toBe('unverified');
    expect(
      verifyMotion(
        {
          radius: 1,
          bounds,
          query: () => {
            throw new Error('failure');
          },
        },
        pose(),
        end,
      ),
    ).toMatchObject({ status: 'unverified', reason: 'query-failed' });
  });
  it('certifies clear translation and tilt using a distance bound', async () => {
    const query = await createPoseQuery(
      { bounds, obstacles: [] },
      { x: 0.5, y: 0.7, z: 0.3 },
    );
    expect(
      verifyMotion(query, pose(-2), {
        ...pose(2),
        rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
      }).status,
    ).toBe('verified');
  });
  it('shares total path-query and deadline budgets across all intervals', async () => {
    const query = await createPoseQuery(
      { bounds, obstacles: [] },
      { x: 0.5, y: 0.5, z: 0.5 },
    );
    expect(
      verifyPath(query, [pose(), pose(1), pose(2)], {
        maxDepth: 18,
        maxQueries: 2,
      }),
    ).toMatchObject({ status: 'unverified', queries: 2 });
    expect(
      verifyPath(query, [pose(), pose(1)], {
        maxDepth: 18,
        maxQueries: 100,
        shouldStop: () => true,
      }),
    ).toMatchObject({ status: 'unverified', queries: 0 });
  });
});
