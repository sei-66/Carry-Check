import { describe, expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import { IDENTITY } from '../src/domain/pose';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import { createModelQuery, floorViolations } from '../src/geometry/model-query';
import {
  validateGeometryModel,
  type GeometryModel,
} from '../src/model/geometry-model';

const dimensionsResult = validateInputSnapshot({
  widthMm: 100,
  depthMm: 100,
  heightMm: 100,
  marginMm: 10,
});
if (!dimensionsResult.ok) throw new Error('Invalid test dimensions');
const dimensions = dimensionsResult.value;
const rectangle = (min: number, max: number) => [
  { x: min, z: -1 },
  { x: max, z: -1 },
  { x: max, z: 1 },
  { x: min, z: 1 },
];
function stackedModel(): GeometryModel {
  const physicalSolids = [
    { id: 'lower-solid', footprint: rectangle(-1, 1), bottomM: -0.2, topM: 0 },
    { id: 'upper-solid', footprint: rectangle(-1, 1), bottomM: 2.8, topM: 3 },
  ];
  return {
    id: 'stacked-floor-regression',
    physicalSolids,
    floorRegions: physicalSolids.map((s) => ({
      id: `${s.id}-region`,
      footprint: s.footprint,
      floorHeightM: s.topM,
      maxLiftM: 1,
      physicalSolidId: s.id,
    })),
    portals: [],
    outerConstraint: {
      id: 'test-outer',
      bounds: { min: { x: -3, y: -1, z: -3 }, max: { x: 3, y: 5, z: 3 } },
    },
  };
}
const state = (x: number, y: number, floorRegionId: string) => ({
  pose: { position: { x, y, z: 0 }, rotation: IDENTITY },
  floorRegionId,
});

describe('explicit floors and terminal reference', () => {
  it.each([
    ['lower-solid-region', 0.35],
    ['upper-solid-region', 3.35],
  ] as const)(
    'verifies motion on %s despite another storey sharing XZ',
    async (id, height) => {
      const query = await createModelQuery(stackedModel(), dimensions);
      const result = verifyModelMotion(
        query,
        state(-0.3, height, id),
        state(0.3, height, id),
      );
      expect(result).toMatchObject({
        status: 'verified',
        floorRegionIds: [id],
      });
    },
  );
  it('cannot switch storeys without a portal even when both projected floors contain the centre', async () => {
    const query = await createModelQuery(stackedModel(), dimensions);
    expect(
      verifyModelMotion(
        query,
        state(0, 0.35, 'lower-solid-region'),
        state(0, 3.35, 'upper-solid-region'),
      ).status,
    ).not.toBe('verified');
  });
  it('accepts a declared terminal reference without inventing a physical LDK floor', async () => {
    const original = stackedModel();
    const model: GeometryModel = {
      ...original,
      floorRegions: [
        ...original.floorRegions,
        {
          id: 'terminal-reference',
          footprint: rectangle(1, 2),
          floorHeightM: 3,
          maxLiftM: 1,
          physicalSolidId: null,
          basis: 'terminal-reference',
        },
      ],
      portals: [
        {
          id: 'upper-terminal',
          fromRegionId: 'upper-solid-region',
          toRegionId: 'terminal-reference',
          edge: [
            { x: 1, z: -1 },
            { x: 1, z: 1 },
          ],
        },
      ],
    };
    expect(() => validateGeometryModel(model)).not.toThrow();
    expect(model.physicalSolids).toHaveLength(2);
    const query = await createModelQuery(model, dimensions);
    expect(
      verifyModelMotion(
        query,
        state(0.7, 3.35, 'upper-solid-region'),
        state(1.5, 3.35, 'terminal-reference'),
      ).status,
    ).toBe('verified');
    const terminal = model.floorRegions[2]!;
    expect(
      floorViolations(
        terminal,
        state(1.5, 3.055, 'terminal-reference').pose,
        dimensions,
      ),
    ).toContain('constraint-below-terminal-reference');
    expect(() =>
      validateGeometryModel({
        ...model,
        floorRegions: [
          ...original.floorRegions,
          { ...terminal, physicalSolidId: 'missing', basis: 'physical' },
        ],
      }),
    ).toThrow();
  });
});
