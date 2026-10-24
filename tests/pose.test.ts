import { describe, expect, it } from 'vitest';
import {
  halfExtents,
  IDENTITY,
  interpolatePose,
  isQuaternion,
  normalizeQuaternion,
  pointMotionBound,
  rotationAngle,
} from '../src/domain/pose';

describe('coordinate and quaternion contract', () => {
  it('maps width X, height Y, depth Z and rotates/tilts a non-cubic box', () => {
    const dimensions = { x: 0.6, y: 1.2, z: 0.8 };
    expect(halfExtents(dimensions, IDENTITY)).toEqual({
      x: 0.3,
      y: 0.6,
      z: 0.4,
    });
    const yaw = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const tilt = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    expect(halfExtents(dimensions, yaw).x).toBeCloseTo(0.4);
    expect(halfExtents(dimensions, tilt).y).toBeCloseTo(0.4);
  });
  it('treats q and -q as identical and interpolates the shortest arc', () => {
    const start = { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY };
    const end = {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: -1 },
    };
    expect(interpolatePose(start, end, 0.5)).toEqual({
      position: { x: 1, y: 0, z: 0 },
      rotation: IDENTITY,
    });
    expect(rotationAngle(IDENTITY, end.rotation)).toBe(0);
    expect(pointMotionBound(start, end, 10)).toBe(2);
  });
  it('rejects invalid quaternions and interpolation fractions', () => {
    expect(isQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toBe(false);
    expect(isQuaternion({ x: 0, y: 0, z: 0, w: Infinity })).toBe(false);
    expect(() => normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toThrow();
    const pose = { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY };
    expect(() => interpolatePose(pose, pose, NaN)).toThrow();
  });
  it('preserves small rotations and their sweep bounds inside the accepted norm band', () => {
    const scaled = (angle: number) => ({
      x: 0,
      y: Math.sin(angle / 2) * 1.0000009,
      z: 0,
      w: Math.cos(angle / 2) * 1.0000009,
    });
    const start = { position: { x: 0, y: 0, z: 0 }, rotation: scaled(-0.0015) },
      end = { position: { x: 0, y: 0, z: 0 }, rotation: scaled(0.0015) };
    expect(isQuaternion(start.rotation)).toBe(true);
    expect(isQuaternion(end.rotation)).toBe(true);
    expect(rotationAngle(start.rotation, end.rotation)).toBeCloseTo(0.003, 12);
    expect(pointMotionBound(start, end, 2)).toBeCloseTo(
      4 * Math.sin(0.0015),
      12,
    );
    expect(
      rotationAngle(IDENTITY, interpolatePose(start, end, 0.5).rotation),
    ).toBeCloseTo(0, 12);
    expect(rotationAngle(IDENTITY, scaled(1e-9))).toBeCloseTo(1e-9, 15);
  });
});
