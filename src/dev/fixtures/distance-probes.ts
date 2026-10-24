import { IDENTITY, type Pose, type Vector3 } from '../../domain/pose';
import type { ConvexPrism } from '../../model/geometry-model';

// Independent mathematical probes. No housing values, rendering or choices.
export interface DistanceProbe {
  readonly id: string;
  readonly solid: ConvexPrism;
  readonly dimensions: Vector3;
  readonly pose: Pose;
  readonly expectedM: number;
}

export function createDistanceProbes(): readonly DistanceProbe[] {
  const rectangle = [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];
  const angle = Math.PI / 4;
  return [
    {
      id: 'distance-corner-v1',
      solid: { id: 'probe-cube', footprint: rectangle, bottomM: -1, topM: 1 },
      dimensions: { x: 1, y: 1, z: 1 },
      pose: { position: { x: 1.52, y: 1.53, z: 1.54 }, rotation: IDENTITY },
      expectedM: Math.hypot(0.02, 0.03, 0.04),
    },
    {
      id: 'distance-edge-v1',
      solid: { id: 'probe-top', footprint: rectangle, bottomM: -1, topM: 0 },
      dimensions: { x: 0.2, y: 0.2, z: 4 },
      pose: {
        position: { x: 0, y: 0.1 * Math.SQRT2 + 0.001, z: 0 },
        rotation: {
          x: 0,
          y: 0,
          z: Math.sin(angle / 2),
          w: Math.cos(angle / 2),
        },
      },
      expectedM: 0.001,
    },
    {
      id: 'distance-thin-v1',
      solid: {
        id: 'probe-thin-triangle',
        footprint: [
          { x: -1, z: -1e-5 },
          { x: 1, z: -1e-5 },
          { x: 0, z: 0 },
        ],
        bottomM: -5e-7,
        topM: 5e-7,
      },
      dimensions: { x: 2, y: 0.002, z: 0.002 },
      pose: {
        position: { x: 0, y: 0, z: 0.001 * Math.SQRT2 + 0.001 },
        rotation: {
          x: Math.sin(angle / 2),
          y: 0,
          z: 0,
          w: Math.cos(angle / 2),
        },
      },
      expectedM: 0.001,
    },
  ];
}
