import { expect, it } from 'vitest';
import { IDENTITY } from '../src/domain/pose';
import {
  createPoseQuery,
  NUMERICAL_ERROR_M,
} from '../src/geometry/rapier-query';

it('covers analytical separated-box gaps across the supported synthetic coordinate range', async () => {
  // Expected Euclidean solid distance is calculated independently of Rapier.
  let largestError = 0;
  for (const center of [-15, 0, 15]) {
    for (const side of [0.001, 0.1, 1, 5]) {
      if (center + side * 1.5 + 0.5 >= 19) continue;
      const query = await createPoseQuery(
        {
          bounds: {
            min: { x: -20, y: -20, z: -20 },
            max: { x: 20, y: 20, z: 20 },
          },
          obstacles: [
            {
              id: 'box',
              pose: { position: { x: center, y: 0, z: 0 }, rotation: IDENTITY },
              shape: {
                kind: 'cuboid',
                dimensions: { x: side, y: side, z: side },
              },
            },
          ],
        },
        { x: side, y: side, z: side },
      );
      for (const gap of [0, 0.0001, 0.00025, 0.001, 0.1, 0.5]) {
        for (const diagonal of [false, true]) {
          const expected = diagonal ? Math.SQRT2 * gap : gap;
          const result = query.query(
            {
              position: {
                x: center + side + gap,
                y: diagonal ? side + gap : 0,
                z: 0,
              },
              rotation: IDENTITY,
            },
            2,
          );
          expect(
            result.lowerBoundM,
            JSON.stringify({ center, side, gap, diagonal, result }),
          ).toBeLessThanOrEqual(expected + 1e-9);
          expect(result.upperBoundM).not.toBeNull();
          expect(result.upperBoundM).toBeGreaterThanOrEqual(expected - 1e-9);
          expect(
            (result.upperBoundM ?? 0) - result.lowerBoundM,
          ).toBeLessThanOrEqual(0.001);
          const measured = result.lowerBoundM + NUMERICAL_ERROR_M;
          largestError = Math.max(largestError, Math.abs(expected - measured));
        }
      }
    }
  }
  expect(largestError).toBeLessThan(NUMERICAL_ERROR_M);
});
