import { expect, it } from 'vitest';
import { validateInputSnapshot } from '../src/domain/dimensions';
import { halfExtents } from '../src/domain/pose';
import { createModelQuery } from '../src/geometry/model-query';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import {
  createMaisonetteModel,
  type HousingOpening,
} from '../src/model/maisonette-model';
import { LARGE_FRIDGE_REFERENCE } from './fixtures/large-fridge-reference';

function projection(
  normal: HousingOpening['normal'],
  point: { readonly x: number; readonly y: number; readonly z: number },
) {
  return normal.x * point.x + normal.y * point.y + normal.z * point.z;
}

function supportAlongNormal(
  normal: HousingOpening['normal'],
  half: { readonly x: number; readonly y: number; readonly z: number },
) {
  return (
    Math.abs(normal.x) * half.x +
    Math.abs(normal.y) * half.y +
    Math.abs(normal.z) * half.z
  );
}

function openingPosition(
  opening: HousingOpening,
  planeDot: number,
  transverse: number,
  y: number,
) {
  const { normal } = opening;
  return opening.widthAxis === 'x'
    ? {
        x: transverse,
        y,
        z: (planeDot - normal.x * transverse - normal.y * y) / normal.z,
      }
    : {
        x: (planeDot - normal.y * y - normal.z * transverse) / normal.x,
        y,
        z: transverse,
      };
}

it('continuously verifies the full large-refrigerator route through the upper-floor right turn', async () => {
  const house = createMaisonetteModel();
  const dimensions = validateInputSnapshot({
    widthMm: 660,
    depthMm: 708,
    heightMm: 1910,
    marginMm: 10,
  });
  if (!dimensions.ok) throw new Error('Invalid large refrigerator dimensions');
  const query = await createModelQuery(house.geometry, dimensions.value);
  for (const [index, state] of LARGE_FRIDGE_REFERENCE.entries()) {
    const observed = query.query(state.pose, state.floorRegionId, 1);
    expect(
      observed,
      `${index} ${state.floorRegionId}: ${JSON.stringify({ pose: state.pose, observed })}`,
    ).toMatchObject({
      packed: { status: 'clear' },
      clearance: { status: 'clear' },
      virtualViolationIds: [],
    });
    const before = LARGE_FRIDGE_REFERENCE[index - 1];
    if (before) {
      const motion = verifyModelMotion(query, before, state);
      expect(motion, `large refrigerator segment ${index - 1}`).toMatchObject({
        status: 'verified',
      });
      if (
        before.floorRegionId === 'region-step-011' &&
        state.floorRegionId === 'region-step-013'
      )
        expect(motion).toMatchObject({
          floorRegionIds: [
            'region-step-011',
            'region-step-012',
            'region-step-013',
          ],
        });
    }
  }
  const first = LARGE_FRIDGE_REFERENCE[0];
  const last = LARGE_FRIDGE_REFERENCE.at(-1);
  if (!first || !last) throw new Error('Missing reference endpoint');
  expect(first.floorRegionId).toMatch(/^region-entry-outside/);
  expect(last.floorRegionId).toBe(house.goalRegionId);
  const entry = house.openings.entry;
  const ldk = house.openings.ldk;
  const entryNormalLength = Math.hypot(
    entry.normal.x,
    entry.normal.y,
    entry.normal.z,
  );
  const ldkNormalLength = Math.hypot(ldk.normal.x, ldk.normal.y, ldk.normal.z);
  const entryHalf = halfExtents(
    dimensions.value.clearance,
    first.pose.rotation,
  );
  const ldkHalf = halfExtents(dimensions.value.clearance, last.pose.rotation);
  expect(
    projection(entry.normal, first.pose.position) +
      supportAlongNormal(entry.normal, entryHalf),
  ).toBeLessThan(entry.approachPlaneM - entry.epsilonM * entryNormalLength);
  expect(
    projection(ldk.normal, last.pose.position) -
      supportAlongNormal(ldk.normal, ldkHalf),
  ).toBeGreaterThan(ldk.departurePlaneM + ldk.epsilonM * ldkNormalLength);
  const guides = house.guide.filter((guide) => guide.stage === 'upper-hall');
  const arrival = guides[0];
  const middle = guides[1];
  if (!arrival || !middle) throw new Error('Missing upper-hall turn guides');
  const arrivalIndex = LARGE_FRIDGE_REFERENCE.findIndex(
    (state) => state.floorRegionId === arrival.floorRegionId,
  );
  const middleIndex = LARGE_FRIDGE_REFERENCE.findIndex(
    (state) => state.floorRegionId === middle.floorRegionId,
  );
  const beforeArrival = LARGE_FRIDGE_REFERENCE[arrivalIndex - 1];
  const arrivalState = LARGE_FRIDGE_REFERENCE[arrivalIndex];
  const middleState = LARGE_FRIDGE_REFERENCE[middleIndex];
  if (!beforeArrival || !arrivalState || !middleState)
    throw new Error('Missing upper-hall turn states');
  expect(arrivalState.pose.position.x).toBeCloseTo(
    beforeArrival.pose.position.x,
    8,
  );
  expect(arrivalState.pose.position.z).toBeLessThan(
    beforeArrival.pose.position.z,
  );
  expect(middleState.pose.position.x).toBeGreaterThan(
    arrivalState.pose.position.x,
  );
  expect(middleState.pose.position.z).toBeCloseTo(
    arrivalState.pose.position.z,
    8,
  );
}, 20_000);

it('rejects the large-refrigerator reference when an intermediate floor portal is removed', async () => {
  const house = createMaisonetteModel();
  const dimensions = validateInputSnapshot({
    widthMm: 660,
    depthMm: 708,
    heightMm: 1910,
    marginMm: 10,
  });
  if (!dimensions.ok) throw new Error('Invalid large refrigerator dimensions');
  const query = await createModelQuery(
    {
      ...house.geometry,
      portals: house.geometry.portals.filter(
        (portal) =>
          !(
            portal.fromRegionId === 'region-step-011' &&
            portal.toRegionId === 'region-step-012'
          ),
      ),
    },
    dimensions.value,
  );
  const beforeIndex = LARGE_FRIDGE_REFERENCE.findIndex(
    (state, index) =>
      state.floorRegionId === 'region-step-011' &&
      LARGE_FRIDGE_REFERENCE[index + 1]?.floorRegionId === 'region-step-013',
  );
  const before = LARGE_FRIDGE_REFERENCE[beforeIndex];
  const after = LARGE_FRIDGE_REFERENCE[beforeIndex + 1];
  if (!before || !after) throw new Error('Missing reference floor transition');
  expect(verifyModelMotion(query, before, after)).toMatchObject({
    status: 'blocked',
    constraintId: 'constraint-floor-membership',
  });
});

it.each([
  {
    name: 'refrigerator',
    widthMm: 557,
    depthMm: 655,
    heightMm: 1410,
    liftM: 0.55,
  },
  {
    name: 'washing machine',
    widthMm: 624,
    depthMm: 633,
    heightMm: 1082,
    liftM: 0.58,
  },
])(
  'continuously verifies a $name reference with a mid-height lift',
  async (input) => {
    const house = createMaisonetteModel();
    const dimensions = validateInputSnapshot({
      ...input,
      marginMm: 10,
    });
    if (!dimensions.ok) throw new Error('Invalid appliance dimensions');
    const query = await createModelQuery(house.geometry, dimensions.value);
    const rotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const half = halfExtents(dimensions.value.packed, rotation);
    const clearanceHalf = halfExtents(dimensions.value.clearance, rotation);
    // Independent reference: preserve the assumed housing dimensions, place the
    // item inside both outer walls, and pass behind the waist cap. These points
    // still require all pose, floor/portal, and swept-motion checks below.
    const exit = house.openings.ldk;
    const exitNormalLength = Math.hypot(
      exit.normal.x,
      exit.normal.y,
      exit.normal.z,
    );
    const exitSupport = supportAlongNormal(exit.normal, clearanceHalf);
    const exitTransverse = (exit.transverseMinM + exit.transverseMaxM) / 2;
    const states = house.guide.map((guide) => {
      const y = guide.floorHeightM + input.liftM + half.y;
      const onEntryOrStair =
        guide.stage === 'entry' || guide.stage === 'stairs';
      const position =
        guide.floorRegionId === house.goalRegionId
          ? openingPosition(
              exit,
              exit.departurePlaneM +
                exitSupport +
                exit.epsilonM * exitNormalLength +
                0.01,
              exitTransverse,
              y,
            )
          : {
              x: onEntryOrStair
                ? Math.max(-0.88, Math.min(0, guide.positionXZ.x))
                : guide.positionXZ.x,
              y,
              z: onEntryOrStair
                ? Math.min(guide.positionXZ.z, 3.445 - clearanceHalf.z - 0.01)
                : guide.positionXZ.z,
            };
      return {
        floorRegionId: guide.floorRegionId,
        pose: { position, rotation },
      };
    });
    const end = states.at(-1);
    if (!end) throw new Error('Missing appliance reference goal');
    expect(end.floorRegionId).toBe(house.goalRegionId);
    expect(
      projection(exit.normal, end.pose.position) -
        supportAlongNormal(exit.normal, clearanceHalf),
    ).toBeGreaterThan(exit.departurePlaneM + exit.epsilonM * exitNormalLength);
    for (const [index, state] of states.entries()) {
      const observed = query.query(state.pose, state.floorRegionId, 1);
      expect(
        observed,
        `${state.floorRegionId}: ${JSON.stringify({ pose: state.pose, observed })}`,
      ).toMatchObject({
        packed: { status: 'clear' },
        clearance: { status: 'clear' },
        virtualViolationIds: [],
      });
      const previous = states[index - 1];
      if (previous)
        expect(
          verifyModelMotion(query, previous, state),
          `${previous.floorRegionId} -> ${state.floorRegionId}`,
        ).toMatchObject({ status: 'verified' });
    }
  },
  20_000,
);
