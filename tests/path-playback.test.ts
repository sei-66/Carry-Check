import { describe, expect, it } from 'vitest';
import { IDENTITY, rotateVector, type Pose } from '../src/domain/pose';
import { poseAtProgress } from '../src/viewer/path-playback';

describe('verified path playback', () => {
  const poses: readonly Pose[] = [
    { position: { x: 0, y: 2, z: -2 }, rotation: IDENTITY },
    {
      position: { x: 0, y: 2, z: 0 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    },
    { position: { x: 0, y: 2, z: 2 }, rotation: IDENTITY },
  ];

  it('keeps the start, intermediate keyframe and endpoint on the verified path', () => {
    expect(poseAtProgress(poses, 0)).toEqual(poses[0]);
    const middle = poseAtProgress(poses, 0.5);
    expect(middle?.position).toEqual(poses[1]?.position);
    expect(middle?.rotation.y).toBeCloseTo(Math.SQRT1_2);
    expect(middle?.rotation.w).toBeCloseTo(Math.SQRT1_2);
    expect(poseAtProgress(poses, 1)).toEqual(poses[2]);
  });

  it('uses linear position and shortest-arc rotation within the active segment', () => {
    const quarter = poseAtProgress(poses, 0.25);
    expect(quarter?.position).toEqual({ x: 0, y: 2, z: -1 });
    if (!quarter) throw new Error('Expected interpolated pose');
    const widthAxis = rotateVector({ x: 1, y: 0, z: 0 }, quarter.rotation);
    expect(widthAxis.x).toBeCloseTo(Math.SQRT1_2);
    expect(widthAxis.y).toBeCloseTo(0);
    expect(widthAxis.z).toBeCloseTo(-Math.SQRT1_2);
    expect(poseAtProgress(poses, 0.75)?.position).toEqual({ x: 0, y: 2, z: 1 });
  });

  it('does not add a full turn between equivalent quaternion signs', () => {
    const signChanged: readonly Pose[] = [
      { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY },
      { position: { x: 4, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: -1 } },
    ];
    expect(poseAtProgress(signChanged, 0.5)).toEqual({
      position: { x: 2, y: 0, z: 0 },
      rotation: IDENTITY,
    });
  });

  it('handles absent or single-pose paths without inventing movement', () => {
    expect(poseAtProgress([], 0.5)).toBeUndefined();
    const pose = poses[0];
    if (!pose) throw new Error('Missing fixture');
    expect(poseAtProgress([pose], 0)).toBe(pose);
    expect(poseAtProgress([pose], 0.5)).toBe(pose);
    expect(poseAtProgress([pose], 1)).toBe(pose);
  });

  it.each([-0.01, 1.01, NaN, Infinity])(
    'rejects playback outside the verified path: %s',
    (progress) => {
      expect(() => poseAtProgress(poses, progress)).toThrow(
        'Invalid playback position',
      );
    },
  );
});
