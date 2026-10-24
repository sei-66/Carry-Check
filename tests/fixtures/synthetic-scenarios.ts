import type { RawDimensions } from '../../src/domain/dimensions';
import { IDENTITY, type Pose, type Vector3 } from '../../src/domain/pose';
import type { GeometryScene, Obstacle } from '../../src/geometry/scene';
import type { SearchProblem } from '../../src/planner/rrt-connect';

export type SyntheticScenarioId = 'straight' | 'rotate' | 'tilt';

export interface SyntheticScenarioFixture {
  readonly id: SyntheticScenarioId;
  readonly input: RawDimensions;
}

export const SYNTHETIC_SCENARIO_FIXTURES: readonly SyntheticScenarioFixture[] =
  [
    {
      id: 'straight',
      input: {
        widthMm: '600',
        depthMm: '800',
        heightMm: '1200',
        marginMm: '10',
      },
    },
    {
      id: 'rotate',
      input: {
        widthMm: '1200',
        depthMm: '400',
        heightMm: '400',
        marginMm: '10',
      },
    },
    {
      id: 'tilt',
      input: {
        widthMm: '400',
        depthMm: '400',
        heightMm: '1200',
        marginMm: '10',
      },
    },
  ];

export interface SyntheticScenario {
  readonly scene: GeometryScene;
  readonly problem: SearchProblem;
}

function wall(id: string, position: Vector3, dimensions: Vector3): Obstacle {
  return {
    id,
    pose: { position, rotation: IDENTITY },
    shape: { kind: 'cuboid', dimensions },
  };
}

// All numbers are test fixtures. No housing reference dimensions are used here.
export function createSyntheticScenario(
  id: SyntheticScenarioId,
): SyntheticScenario {
  const bounds = { min: { x: -2, y: 0, z: -3 }, max: { x: 2, y: 4, z: 3 } };
  const aperture =
    id === 'rotate' ? { width: 0.8, height: 2.4 } : { width: 2.4, height: 0.8 };
  const obstacles: Obstacle[] =
    id === 'straight'
      ? []
      : [
          wall(
            'gate-left',
            { x: -(2 + aperture.width / 2) / 2, y: 2, z: 0 },
            { x: 2 - aperture.width / 2, y: 4, z: 0.2 },
          ),
          wall(
            'gate-right',
            { x: (2 + aperture.width / 2) / 2, y: 2, z: 0 },
            { x: 2 - aperture.width / 2, y: 4, z: 0.2 },
          ),
          wall(
            'gate-bottom',
            { x: 0, y: (2 - aperture.height / 2) / 2, z: 0 },
            { x: aperture.width, y: 2 - aperture.height / 2, z: 0.2 },
          ),
          wall(
            'gate-top',
            { x: 0, y: (6 + aperture.height / 2) / 2, z: 0 },
            { x: aperture.width, y: 2 - aperture.height / 2, z: 0.2 },
          ),
        ];
  const rotated =
    id === 'rotate'
      ? { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
      : { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  const guides: Pose[] = [-1.5, -0.8, 0, 0.8, 1.5].map((z) => ({
    position: { x: 0, y: 2, z },
    rotation: rotated,
  }));
  return {
    scene: { bounds, obstacles },
    problem: {
      start: { position: { x: 0, y: 2, z: -2 }, rotation: IDENTITY },
      goal: { position: { x: 0, y: 2, z: 2 }, rotation: IDENTITY },
      guides: id === 'straight' ? [] : guides,
    },
  };
}
