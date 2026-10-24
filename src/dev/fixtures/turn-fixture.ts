import type { ValidatedDimensions } from '../../domain/dimensions';
import {
  validateGeometryModel,
  type GeometryModel,
  type PointXZ,
} from '../../model/geometry-model';

export const TURN_FIXTURE_ID = 'fixture-m0-turn-v1';

// All values are independent regression assumptions from docs/geometry-verification.md.
// They are neither measurements nor the geometry of the target home.
export const TURN_FIXTURE_DIMENSIONS: ValidatedDimensions = {
  snapshot: { widthMm: 100, heightMm: 100, depthMm: 100, marginMm: 10 },
  packed: { x: 0.1, y: 0.1, z: 0.1 },
  clearance: { x: 0.12, y: 0.12, z: 0.12 },
};

// F-OUTER-HEIGHT: a fixture-only artificial permitted height, not a ceiling.
// Its floor-plan includes the waist wall so partial overhangs can be assessed
// against the physical wall instead of an infinitely tall forbidden column.
export const TURN_FIXTURE_OUTER_HEIGHT = { minM: -0.2, maxM: 2 } as const;

interface FixtureFloor {
  readonly label: string;
  readonly heightM: number;
  readonly footprint: readonly PointXZ[];
}

export function createTurnFixture(): GeometryModel {
  const floors: readonly FixtureFloor[] = [
    {
      label: 'F0',
      heightM: 0,
      footprint: [
        { x: -0.8, z: -0.25 },
        { x: -0.05, z: -0.25 },
        { x: -0.05, z: 0 },
        { x: -0.8, z: 0 },
      ],
    },
    {
      label: 'P1',
      heightM: 0.18,
      footprint: [
        { x: -0.8, z: 0 },
        { x: -0.05, z: 0 },
        { x: -0.05, z: 0.05 },
        { x: -0.8, z: 0.8 },
      ],
    },
    {
      label: 'P2',
      heightM: 0.36,
      footprint: [
        { x: -0.8, z: 0.8 },
        { x: -0.05, z: 0.05 },
        { x: 0, z: 0.05 },
        { x: 0, z: 0.8 },
      ],
    },
    {
      label: 'P3',
      heightM: 0.54,
      footprint: [
        { x: 0, z: 0.8 },
        { x: 0, z: 0.05 },
        { x: 0.05, z: 0.05 },
        { x: 0.8, z: 0.8 },
      ],
    },
    {
      label: 'P4',
      heightM: 0.72,
      footprint: [
        { x: 0.8, z: 0.8 },
        { x: 0.05, z: 0.05 },
        { x: 0.05, z: 0 },
        { x: 0.8, z: 0 },
      ],
    },
    {
      label: 'F5',
      heightM: 0.9,
      footprint: [
        { x: 0.05, z: -0.25 },
        { x: 0.8, z: -0.25 },
        { x: 0.8, z: 0 },
        { x: 0.05, z: 0 },
      ],
    },
  ];
  const edges: readonly (readonly [PointXZ, PointXZ])[] = [
    [
      { x: -0.8, z: 0 },
      { x: -0.05, z: 0 },
    ],
    [
      { x: -0.05, z: 0.05 },
      { x: -0.8, z: 0.8 },
    ],
    [
      { x: 0, z: 0.05 },
      { x: 0, z: 0.8 },
    ],
    [
      { x: 0.05, z: 0.05 },
      { x: 0.8, z: 0.8 },
    ],
    [
      { x: 0.05, z: 0 },
      { x: 0.8, z: 0 },
    ],
  ];

  const model: GeometryModel = {
    id: TURN_FIXTURE_ID,
    physicalSolids: [
      ...floors.map((floor) => ({
        id: `solid-${floor.label}`,
        footprint: floor.footprint,
        bottomM: -0.2,
        topM: floor.heightM,
      })),
      {
        id: 'solid-waist',
        footprint: [
          { x: -0.05, z: -0.25 },
          { x: 0.05, z: -0.25 },
          { x: 0.05, z: 0.05 },
          { x: -0.05, z: 0.05 },
        ],
        bottomM: -0.2,
        topM: 1.2,
      },
    ],
    floorRegions: floors.map((floor) => ({
      id: `region-${floor.label}`,
      footprint: floor.footprint,
      floorHeightM: floor.heightM,
      maxLiftM: 0.6,
      physicalSolidId: `solid-${floor.label}`,
    })),
    portals: edges.map((edge, index) => {
      const from = floors[index];
      const to = floors[index + 1];
      if (!from || !to) throw new Error('Missing fixture portal floor');
      return {
        id: `portal-${from.label}-${to.label}`,
        fromRegionId: `region-${from.label}`,
        toRegionId: `region-${to.label}`,
        edge,
      };
    }),
    outerConstraint: {
      id: 'constraint-outer',
      bounds: {
        min: { x: -0.8, y: TURN_FIXTURE_OUTER_HEIGHT.minM, z: -0.25 },
        max: { x: 0.8, y: TURN_FIXTURE_OUTER_HEIGHT.maxM, z: 0.8 },
      },
    },
  };
  validateGeometryModel(model);
  return model;
}
