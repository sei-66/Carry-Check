import { BoxGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { IDENTITY } from '../src/domain/pose';
import { createPoseQuery } from '../src/geometry/rapier-query';

describe('Rapier solid queries versus BVH surface queries', () => {
  it.each([
    {
      name: 'separated',
      x: 2,
      intersects: false,
      surfaceIntersects: false,
      surfaceDistance: 0.5,
    },
    {
      name: 'crossing',
      x: 1,
      intersects: true,
      surfaceIntersects: true,
      surfaceDistance: 0,
    },
    {
      name: 'contained',
      x: 0,
      intersects: true,
      surfaceIntersects: false,
      surfaceDistance: 0.5,
    },
    {
      name: 'face contact',
      x: 1.5,
      intersects: true,
      surfaceIntersects: true,
      surfaceDistance: 0,
    },
  ])('$name', async ({ x, intersects, surfaceIntersects, surfaceDistance }) => {
    const obstacleGeometry = new BoxGeometry(2, 2, 2);
    const boxGeometry = new BoxGeometry(1, 1, 1);
    try {
      const bvh = new MeshBVH(obstacleGeometry);
      const transform = new Matrix4().compose(
        new Vector3(x, 0, 0),
        new Quaternion(),
        new Vector3(1, 1, 1),
      );
      expect(Boolean(bvh.intersectsGeometry(boxGeometry, transform))).toBe(
        surfaceIntersects,
      );
      expect(
        bvh.closestPointToGeometry(boxGeometry, transform)?.distance,
      ).toBeCloseTo(surfaceDistance);
      const query = await createPoseQuery(
        {
          bounds: {
            min: { x: -10, y: -10, z: -10 },
            max: { x: 10, y: 10, z: 10 },
          },
          obstacles: [
            {
              id: 'solid',
              pose: { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY },
              shape: { kind: 'cuboid', dimensions: { x: 2, y: 2, z: 2 } },
            },
          ],
        },
        { x: 1, y: 1, z: 1 },
      );
      const contact = query.query(
        { position: { x, y: 0, z: 0 }, rotation: IDENTITY },
        1,
      );
      expect(contact.status === 'blocked').toBe(intersects);
      if (!intersects)
        expect(contact.upperBoundM).toBeCloseTo(surfaceDistance, 3);
    } finally {
      obstacleGeometry.dispose();
      boxGeometry.dispose();
    }
  });
});
