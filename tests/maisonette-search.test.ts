import { beforeAll, describe, expect, it } from 'vitest';
import {
  validateInputSnapshot,
  type InputSnapshot,
} from '../src/domain/dimensions';
import {
  halfExtents,
  IDENTITY,
  rotationAngle,
  type Pose,
} from '../src/domain/pose';
import { verifyModelMotion } from '../src/geometry/floor-motion';
import {
  createModelQuery,
  footprintLocation,
} from '../src/geometry/model-query';
import type { ModelQuery } from '../src/geometry/model-query';
import { createMaisonetteModel } from '../src/model/maisonette-model';
import {
  maisonetteOrientationCandidates,
  maisonetteOpeningTransverseCandidates,
  MAX_MAISONETTE_QUERIES,
  searchMaisonette,
} from '../src/planner/maisonette-search';

const house = createMaisonetteModel();
const options = { seed: 48_921, maxNodes: 5_000, maxTimeMs: 10_000 } as const;
const snapshots = {
  small: { widthMm: 120, depthMm: 180, heightMm: 140, marginMm: 10 },
  upright: { widthMm: 1000, depthMm: 300, heightMm: 200, marginMm: 10 },
  tallAppliance: {
    widthMm: 557,
    depthMm: 655,
    heightMm: 1410,
    marginMm: 10,
  },
  verticalWasher: {
    widthMm: 624,
    depthMm: 633,
    heightMm: 1082,
    marginMm: 10,
  },
  largeFridge: {
    widthMm: 660,
    depthMm: 708,
    heightMm: 1910,
    marginMm: 10,
  },
  impossible: { widthMm: 5000, depthMm: 5000, heightMm: 5000, marginMm: 5 },
} satisfies Record<string, InputSnapshot>;
const queries = new Map<string, Promise<ModelQuery>>();

function modelQuery(snapshot: InputSnapshot): Promise<ModelQuery> {
  const key = JSON.stringify(snapshot);
  let query = queries.get(key);
  if (!query) {
    const validation = validateInputSnapshot(snapshot);
    if (!validation.ok) throw new Error('Test snapshot must be valid');
    query = createModelQuery(house.geometry, validation.value);
    queries.set(key, query);
  }
  return query;
}

function dot(
  normal: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
) {
  return normal.x * point.x + normal.y * point.y + normal.z * point.z;
}

function supportAlongNormal(
  half: { readonly x: number; readonly y: number; readonly z: number },
  normal: { readonly x: number; readonly y: number; readonly z: number },
) {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return (
    (Math.abs(normal.x) * half.x +
      Math.abs(normal.y) * half.y +
      Math.abs(normal.z) * half.z) /
    length
  );
}

function expectStartClearanceInsideBounds(
  pose: Pose,
  clearance: { readonly x: number; readonly y: number; readonly z: number },
) {
  const half = halfExtents(clearance, pose.rotation);
  expect(pose.position.x - half.x).toBeGreaterThanOrEqual(
    house.startBounds.min.x,
  );
  expect(pose.position.x + half.x).toBeLessThanOrEqual(house.startBounds.max.x);
  expect(pose.position.z - half.z).toBeGreaterThanOrEqual(
    house.startBounds.min.z,
  );
  expect(pose.position.z + half.z).toBeLessThanOrEqual(house.startBounds.max.z);
}

function transverseCoordinate(
  opening: (typeof house)['openings']['ldk'],
  point: { readonly x: number; readonly z: number },
) {
  return opening.widthAxis === 'x' ? point.x : point.z;
}

const ldkApproachRegionIds = new Set(
  house.guide
    .filter((guide) => guide.stage === 'upper-hall')
    .map((guide) => guide.floorRegionId),
);

describe('maisonette floor-aware search', () => {
  beforeAll(async () => {
    await modelQuery(snapshots.small);
  }, 30_000);

  it('keeps a centered opening candidate when only the plane epsilon does not fit', () => {
    const candidates = maisonetteOpeningTransverseCandidates(
      house.openings.ldk,
      IDENTITY,
      { x: 0.719, y: 1.14, z: 0.719 },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBeCloseTo(1.135, 8);
  });

  it('finds and independently verifies the small-box route within the standard budget', async () => {
    const query = await modelQuery(snapshots.small);
    const first = searchMaisonette(query, house, options);
    expect(first.status).toBe('path-found');
    if (first.status !== 'path-found') return;
    expect(first.nodesVisited).toBeLessThan(options.maxNodes);
    expect(first.elapsedMs).toBeLessThan(options.maxTimeMs);
    expect(first.queries).toBeLessThanOrEqual(MAX_MAISONETTE_QUERIES);
    expect(first.poses.length).toBe(first.floorRegionIds.length);
    expect(first.floorRegionIds[0]).toMatch(/^region-entry-outside/);
    expect(first.floorRegionIds.at(-1)).toBe(house.goalRegionId);
    expect(first.floorRegionIds.slice(0, -1)).not.toContain(house.goalRegionId);

    const dimensions = query.dimensions;
    const entry = house.openings.entry;
    const ldk = house.openings.ldk;
    const start = first.poses[0];
    const goal = first.poses.at(-1);
    const approach = first.poses.at(-2);
    if (!start || !goal || !approach) throw new Error('Missing route endpoint');
    expectStartClearanceInsideBounds(start, dimensions.clearance);
    const entrySupport = supportAlongNormal(
      halfExtents(dimensions.clearance, start.rotation),
      entry.normal,
    );
    expect(
      (entry.approachPlaneM - dot(entry.normal, start.position)) /
        Math.hypot(entry.normal.x, entry.normal.y, entry.normal.z),
    ).toBeCloseTo(1, 8);
    expect(
      dot(entry.normal, start.position) + entrySupport,
    ).toBeLessThanOrEqual(
      entry.approachPlaneM -
        entry.epsilonM *
          Math.hypot(entry.normal.x, entry.normal.y, entry.normal.z) +
        1e-10,
    );
    for (let index = 0; index < first.poses.length - 1; index++) {
      const before = first.poses[index];
      const after = first.poses[index + 1];
      const beforeFloor = first.floorRegionIds[index];
      if (
        !before ||
        !after ||
        !beforeFloor ||
        !house.startRegionIds.includes(beforeFloor)
      )
        continue;
      expect(dot(entry.normal, after.position)).toBeGreaterThanOrEqual(
        dot(entry.normal, before.position) - 1e-10,
      );
    }
    const exitSupport = supportAlongNormal(
      halfExtents(dimensions.clearance, goal.rotation),
      ldk.normal,
    );
    const normalLength = Math.hypot(ldk.normal.x, ldk.normal.y, ldk.normal.z);
    expect(dot(ldk.normal, approach.position)).toBeCloseTo(
      ldk.approachPlaneM - exitSupport - ldk.epsilonM * normalLength,
      8,
    );
    expect(dot(ldk.normal, goal.position)).toBeCloseTo(
      ldk.departurePlaneM + exitSupport + ldk.epsilonM * normalLength,
      8,
    );
    const terminalApproachRegionId = house.guide
      .filter((guide) => guide.stage === 'upper-hall')
      .at(-1)?.floorRegionId;
    expect(first.floorRegionIds.at(-2)).toBe(terminalApproachRegionId);
    expect(rotationAngle(approach.rotation, goal.rotation)).toBeLessThan(1e-8);
    expect(approach.position.y).toBe(goal.position.y);
    expect(transverseCoordinate(ldk, approach.position)).toBeCloseTo(
      transverseCoordinate(ldk, goal.position),
      8,
    );
    expect(
      dot(ldk.normal, goal.position) - dot(ldk.normal, approach.position),
    ).toBeGreaterThan(0);
    for (let index = 0; index < first.poses.length - 1; index++) {
      const pose = first.poses[index];
      const floorRegionId = first.floorRegionIds[index];
      if (!pose || !floorRegionId || !ldkApproachRegionIds.has(floorRegionId))
        continue;
      const support = supportAlongNormal(
        halfExtents(dimensions.clearance, pose.rotation),
        ldk.normal,
      );
      expect(dot(ldk.normal, pose.position) + support).toBeLessThanOrEqual(
        ldk.approachPlaneM - ldk.epsilonM * normalLength + 1e-8,
      );
    }
    for (let index = 1; index < first.poses.length - 1; index++) {
      const before = first.poses[index - 1];
      const after = first.poses[index];
      const beforeFloor = first.floorRegionIds[index - 1];
      const afterFloor = first.floorRegionIds[index];
      if (
        !before ||
        !after ||
        !beforeFloor ||
        !afterFloor ||
        (!ldkApproachRegionIds.has(beforeFloor) &&
          !ldkApproachRegionIds.has(afterFloor))
      )
        continue;
      const angularSlack =
        2 *
        query.clearance.radius *
        Math.sin(rotationAngle(before.rotation, after.rotation) / 4);
      const supportBound =
        Math.max(
          supportAlongNormal(
            halfExtents(dimensions.clearance, before.rotation),
            ldk.normal,
          ),
          supportAlongNormal(
            halfExtents(dimensions.clearance, after.rotation),
            ldk.normal,
          ),
        ) + angularSlack;
      expect(
        Math.max(
          dot(ldk.normal, before.position),
          dot(ldk.normal, after.position),
        ) + supportBound,
      ).toBeLessThanOrEqual(
        ldk.approachPlaneM - ldk.epsilonM * normalLength + 1e-8,
      );
    }

    for (let index = 0; index < first.poses.length; index++) {
      const pose = first.poses[index];
      const floorRegionId = first.floorRegionIds[index];
      if (!pose || !floorRegionId) throw new Error('Missing route state');
      const result = query.query(pose, floorRegionId, 0.3);
      expect(result.packed.status, floorRegionId).toBe('clear');
      expect(result.clearance.status, floorRegionId).toBe('clear');
      expect(result.virtualViolationIds, floorRegionId).toEqual([]);
      const region = query.model.floorRegions.find(
        (item) => item.id === floorRegionId,
      );
      expect(region).toBeDefined();
      if (region)
        expect(footprintLocation(region.footprint, pose.position)).toBe(
          'inside',
        );
      const previousPose = first.poses[index - 1];
      const previousFloor = first.floorRegionIds[index - 1];
      if (previousPose && previousFloor)
        expect(
          verifyModelMotion(
            query,
            { pose: previousPose, floorRegionId: previousFloor },
            { pose, floorRegionId },
          ).status,
        ).toBe('verified');
    }

    const repeat = searchMaisonette(query, house, options);
    expect(repeat.status).toBe('path-found');
    if (repeat.status === 'path-found') {
      expect(repeat.poses).toEqual(first.poses);
      expect(repeat.floorRegionIds).toEqual(first.floorRegionIds);
      expect(repeat.nodesVisited).toBe(first.nodesVisited);
      expect(repeat.queries).toBe(first.queries);
    }
  }, 30_000);

  it('keeps route poses isolated from diagnostic callback mutations', async () => {
    const query = await modelQuery(snapshots.small);
    const baseline = searchMaisonette(query, house, options);
    expect(baseline.status).toBe('path-found');
    if (baseline.status !== 'path-found') return;

    const observed = searchMaisonette(
      query,
      house,
      options,
      undefined,
      undefined,
      (diagnostic) => {
        if (diagnostic.kind !== 'candidate') return;
        Object.assign(diagnostic.position, { x: 9, y: 9, z: 9 });
        Object.assign(diagnostic.rotation, { x: 1, y: 1, z: 1, w: 0 });
      },
    );
    expect(observed.status).toBe('path-found');
    if (observed.status !== 'path-found') return;
    expect(observed.poses).toEqual(baseline.poses);
    expect(observed.floorRegionIds).toEqual(baseline.floorRegionIds);
  }, 30_000);

  it.each([
    { name: 'refrigerator', snapshot: snapshots.tallAppliance },
    { name: 'vertical washer', snapshot: snapshots.verticalWasher },
    { name: 'large refrigerator', snapshot: snapshots.largeFridge },
  ])(
    'finds and continuously verifies the $name route within the standard budget',
    async ({ snapshot }) => {
      const query = await modelQuery(snapshot);
      const searchOptions = {
        seed: 20_260_930,
        maxNodes: 5_000,
        maxTimeMs: 15_000,
      } as const;
      const result = searchMaisonette(query, house, searchOptions);
      expect(result.status).toBe('path-found');
      if (result.status !== 'path-found') return;
      expect(result.nodesVisited).toBeLessThanOrEqual(searchOptions.maxNodes);
      expect(result.elapsedMs).toBeLessThan(searchOptions.maxTimeMs);
      expect(result.queries).toBeLessThanOrEqual(MAX_MAISONETTE_QUERIES);
      expect(result.poses.length).toBe(result.floorRegionIds.length);
      const start = result.poses[0];
      if (!start) throw new Error('Missing appliance start');
      expectStartClearanceInsideBounds(start, query.dimensions.clearance);
      const entry = house.openings.entry;
      const startProjection = dot(entry.normal, start.position);
      expect(
        (entry.approachPlaneM - startProjection) /
          Math.hypot(entry.normal.x, entry.normal.y, entry.normal.z),
      ).toBeCloseTo(1, 8);
      expect(
        startProjection +
          supportAlongNormal(
            halfExtents(query.dimensions.clearance, start.rotation),
            entry.normal,
          ),
      ).toBeLessThanOrEqual(
        entry.approachPlaneM -
          entry.epsilonM *
            Math.hypot(entry.normal.x, entry.normal.y, entry.normal.z) +
          1e-10,
      );

      for (let index = 0; index < result.poses.length; index++) {
        const pose = result.poses[index];
        const floorRegionId = result.floorRegionIds[index];
        if (!pose || !floorRegionId) throw new Error('Missing appliance state');
        const observed = query.query(pose, floorRegionId, 0.3);
        expect(observed.packed.status, floorRegionId).toBe('clear');
        expect(observed.clearance.status, floorRegionId).toBe('clear');
        expect(observed.virtualViolationIds, floorRegionId).toEqual([]);
        const region = query.model.floorRegions.find(
          (item) => item.id === floorRegionId,
        );
        expect(region).toBeDefined();
        if (region)
          expect(footprintLocation(region.footprint, pose.position)).toBe(
            'inside',
          );
        const previousPose = result.poses[index - 1];
        const previousFloor = result.floorRegionIds[index - 1];
        if (
          previousPose &&
          previousFloor &&
          house.startRegionIds.includes(previousFloor)
        )
          expect(dot(entry.normal, pose.position)).toBeGreaterThanOrEqual(
            dot(entry.normal, previousPose.position) - 1e-10,
          );
        if (previousPose && previousFloor)
          expect(
            verifyModelMotion(
              query,
              { pose: previousPose, floorRegionId: previousFloor },
              { pose, floorRegionId },
            ).status,
          ).toBe('verified');
      }
    },
  );

  it('filters a long box whose rear would overhang the finite exterior floor', async () => {
    const query = await modelQuery({
      widthMm: 100,
      depthMm: 1900,
      heightMm: 1200,
      marginMm: 10,
    });
    const blockedTemplate = query.query(
      { position: { x: 0, y: 0.7, z: -1.145 }, rotation: IDENTITY },
      house.startRegionIds[0]!,
      0.3,
    );
    let identityStartQueries = 0;
    const blockedQuery: ModelQuery = {
      ...query,
      query(pose, floorRegionId) {
        if (
          house.startRegionIds.includes(floorRegionId) &&
          Math.abs(pose.position.z + 1.145) < 1e-8 &&
          rotationAngle(pose.rotation, IDENTITY) < 1e-8
        )
          identityStartQueries++;
        return {
          packed: { ...blockedTemplate.packed, status: 'blocked' as const },
          clearance: {
            ...blockedTemplate.clearance,
            status: 'blocked' as const,
          },
          virtualViolationIds: [],
        };
      },
    };
    const budget = { seed: 20_260_930, maxNodes: 5_000, maxTimeMs: 15_000 };
    searchMaisonette(blockedQuery, house, budget);
    expect(identityStartQueries).toBe(0);

    // The enlarged rear bound admits the identity candidate, proving that
    // the finite-floor check is what excludes it in the real model.
    const expandedHouse = {
      ...house,
      startBounds: {
        ...house.startBounds,
        min: { ...house.startBounds.min, z: -3 },
      },
    };
    searchMaisonette(blockedQuery, expandedHouse, budget);
    expect(identityStartQueries).toBeGreaterThan(0);
  }, 30_000);

  it.each([
    { name: 'small box', snapshot: snapshots.small },
    { name: 'large refrigerator', snapshot: snapshots.largeFridge },
  ])(
    'rejects an exterior guide behind the $name start without accepting a retreating route',
    async ({ snapshot }) => {
      const query = await modelQuery(snapshot);
      const rearwardHouse = {
        ...house,
        guide: house.guide.map((guide, index) =>
          index === 0
            ? { ...guide, positionXZ: { ...guide.positionXZ, z: -1.4 } }
            : guide,
        ),
      };
      const rejectedPhases = new Set<string>();
      const rejectedLayerIndexes = new Set<number | null>();
      const result = searchMaisonette(
        query,
        rearwardHouse,
        { seed: 20_260_930, maxNodes: 5_000, maxTimeMs: 15_000 },
        undefined,
        undefined,
        (diagnostic) => {
          if (
            diagnostic.kind === 'edge' &&
            diagnostic.detail === 'entry-initial-retreat'
          ) {
            rejectedPhases.add(diagnostic.phase);
            rejectedLayerIndexes.add(diagnostic.layerIndex);
          }
        },
      );
      expect(rejectedPhases.has('reference')).toBe(true);
      expect(rejectedPhases.has('layer-connect')).toBe(true);
      expect(rejectedLayerIndexes.has(0)).toBe(true);
      if (snapshot === snapshots.largeFridge)
        expect(rejectedLayerIndexes.has(1)).toBe(true);
      if (result.status !== 'path-found') return;
      for (let index = 1; index < result.poses.length; index++) {
        const before = result.poses[index - 1];
        const after = result.poses[index];
        const fromRegionId = result.floorRegionIds[index - 1];
        if (!before || !after || !fromRegionId)
          throw new Error('Missing route edge');
        if (!house.startRegionIds.includes(fromRegionId)) continue;
        expect(
          dot(house.openings.entry.normal, after.position),
        ).toBeGreaterThanOrEqual(
          dot(house.openings.entry.normal, before.position) - 1e-10,
        );
      }
    },
  );

  it('does not find a route through an explicitly occluded stair region', async () => {
    const query = await modelQuery(snapshots.tallAppliance);
    const occludedRegionId = 'region-step-007';
    const occludedQuery: ModelQuery = {
      ...query,
      query(pose, floorRegionId, predictionM) {
        const observed = query.query(pose, floorRegionId, predictionM);
        if (floorRegionId !== occludedRegionId) return observed;
        return {
          ...observed,
          packed: { ...observed.packed, status: 'blocked' as const },
          clearance: { ...observed.clearance, status: 'blocked' as const },
        };
      },
    };
    const result = searchMaisonette(occludedQuery, house, {
      ...options,
      maxTimeMs: 15_000,
    });
    expect(result.status).toBe('path-not-found');
  }, 30_000);

  it('does not compare a lower-floor projection with the LDK approach plane', async () => {
    const query = await modelQuery(snapshots.tallAppliance);
    const testHouse = {
      ...house,
      openings: {
        ...house.openings,
        // Move the controlled plane across the lower route so this test can
        // observe a lower-floor projection beyond it in the +X v3 model.
        ldk: { ...house.openings.ldk, approachPlaneM: -1 },
      },
    };
    const noCollision = {
      status: 'clear',
      lowerBoundM: 1,
      upperBoundM: 1,
      obstacleId: null,
      limitingSolidId: 'controlled-test-query',
      intersectingSolidIds: [],
      diagnosticsEnabled: false,
      unmeasuredSolidIds: [],
      rapierRangeMismatchIds: [],
      rapierDistanceMismatchIds: [],
      rapierUnavailableSolidIds: [],
      rapierQueryFailureIds: [],
    } satisfies ReturnType<ModelQuery['packed']['query']>;
    let lowerFloorProjectionQueries = 0;
    const queryWithoutCollision: ModelQuery = {
      ...query,
      motionQuery: {
        ...query.motionQuery,
        query: () => ({
          status: 'clear',
          lowerBoundM: 1,
          upperBoundM: 1,
          obstacleId: 'controlled-test-query',
        }),
        sweepLowerBound: () => 1,
      },
      query(pose, floorRegionId) {
        const support = supportAlongNormal(
          halfExtents(query.dimensions.clearance, pose.rotation),
          testHouse.openings.ldk.normal,
        );
        if (
          !ldkApproachRegionIds.has(floorRegionId) &&
          dot(testHouse.openings.ldk.normal, pose.position) + support >
            testHouse.openings.ldk.approachPlaneM +
              testHouse.openings.ldk.epsilonM
        )
          lowerFloorProjectionQueries++;
        return {
          packed: noCollision,
          clearance: noCollision,
          virtualViolationIds: [],
        };
      },
    };

    // The controlled collision result isolates the plane-region guard. Floor
    // membership and portal continuity remain checked by the real verifier.
    const result = searchMaisonette(queryWithoutCollision, testHouse, {
      ...options,
      maxNodes: 2,
    });
    expect(result).toMatchObject({
      status: 'path-not-found',
      reason: 'node-limit',
      nodesVisited: 2,
    });
    expect(lowerFloorProjectionQueries).toBeGreaterThan(0);
  }, 30_000);

  it('tries a six-degree orientation lattice and finds the upright long-box case within budget', async () => {
    const candidates = maisonetteOrientationCandidates(options.seed);
    expect(candidates).toEqual(maisonetteOrientationCandidates(options.seed));
    const axisLengths = [0.111, 0.227, 0.359];
    const principalAxisPermutations = new Set<string>();
    for (const rotation of candidates) {
      const half = halfExtents(
        { x: axisLengths[0]!, y: axisLengths[1]!, z: axisLengths[2]! },
        rotation,
      );
      const permutation = [half.x, half.y, half.z].map((value) =>
        axisLengths.findIndex((length) => Math.abs(value * 2 - length) < 1e-8),
      );
      if (
        permutation.every((index) => index >= 0) &&
        new Set(permutation).size === 3
      )
        principalAxisPermutations.add(permutation.join(','));
    }
    expect(principalAxisPermutations.size).toBe(6);
    expect(candidates.some((rotation) => Math.abs(rotation.x) > 1e-4)).toBe(
      true,
    );
    expect(candidates.some((rotation) => Math.abs(rotation.y) > 1e-4)).toBe(
      true,
    );
    expect(candidates.some((rotation) => Math.abs(rotation.z) > 1e-4)).toBe(
      true,
    );
    expect(
      candidates.some(
        (rotation) =>
          Math.abs(rotation.x) > 1e-4 &&
          Math.abs(rotation.y) > 1e-4 &&
          Math.abs(rotation.z) > 1e-4,
      ),
    ).toBe(true);

    const query = await modelQuery(snapshots.upright);
    const result = searchMaisonette(query, house, options);
    expect(result.status, JSON.stringify(result)).toBe('path-found');
    if (result.status !== 'path-found') return;
    expect(result.nodesVisited).toBeLessThan(options.maxNodes);
    expect(result.elapsedMs).toBeLessThan(options.maxTimeMs);
    expect(result.queries).toBeLessThanOrEqual(MAX_MAISONETTE_QUERIES);
    expect(
      result.poses.some(
        (pose) => rotationAngle(IDENTITY, pose.rotation) > Math.PI / 3,
      ),
    ).toBe(true);
    for (let index = 1; index < result.poses.length; index++) {
      const before = result.poses[index - 1];
      const after = result.poses[index];
      const beforeFloor = result.floorRegionIds[index - 1];
      const afterFloor = result.floorRegionIds[index];
      if (!before || !after || !beforeFloor || !afterFloor)
        throw new Error('Missing upright route state');
      expect(
        verifyModelMotion(
          query,
          { pose: before, floorRegionId: beforeFloor },
          { pose: after, floorRegionId: afterFloor },
        ).status,
      ).toBe('verified');
    }
  }, 30_000);

  it('reaches sampled fallback layers when the guide point is unavailable', async () => {
    const query = await modelQuery(snapshots.small);
    const restrictedGuide = house.guide.find(
      (guide) => guide.floorRegionId === 'region-doma',
    );
    if (!restrictedGuide) throw new Error('Missing controlled guide point');
    let rejectedGuideQueries = 0;
    let clearAlternativeQueries = 0;
    const blockedTemplate = query.query(
      {
        position: {
          ...restrictedGuide.positionXZ,
          y:
            restrictedGuide.floorHeightM +
            0.38 +
            halfExtents(query.dimensions.packed, IDENTITY).y,
        },
        rotation: IDENTITY,
      },
      restrictedGuide.floorRegionId,
      0.3,
    );
    const conservativelyBlocked = {
      ...blockedTemplate,
      clearance: { ...blockedTemplate.clearance, status: 'blocked' as const },
    };
    const queryWithOneRejectedGuidePose: ModelQuery = {
      ...query,
      query(pose, floorRegionId, predictionM) {
        const isRestrictedGuidePose =
          floorRegionId === restrictedGuide.floorRegionId &&
          Math.hypot(
            pose.position.x - restrictedGuide.positionXZ.x,
            pose.position.z - restrictedGuide.positionXZ.z,
          ) < 1e-8;
        if (isRestrictedGuidePose) rejectedGuideQueries++;
        // Keep this fallback-only regression cheap by pruning non-identity
        // samples. The accepted identity states and every swept edge below
        // still use the real physical geometry and the real motion verifier.
        if (
          isRestrictedGuidePose ||
          rotationAngle(IDENTITY, pose.rotation) >= 1e-8
        )
          return conservativelyBlocked;
        const measured = query.query(pose, floorRegionId, predictionM);
        if (
          floorRegionId === restrictedGuide.floorRegionId &&
          measured.packed.status === 'clear' &&
          measured.clearance.status === 'clear'
        )
          clearAlternativeQueries++;
        return measured;
      },
    };

    // This controlled query removes non-identity candidates to keep this test
    // focused on fallback sampling. It rejects the exact guide point while
    // accepted states and every swept edge still use the real model query; the
    // fixture is not evidence that a real residence route has been proven.
    const result = searchMaisonette(
      queryWithOneRejectedGuidePose,
      house,
      options,
    );
    expect(rejectedGuideQueries).toBeGreaterThan(0);
    expect(clearAlternativeQueries).toBeGreaterThan(0);
    expect(result.status).toBe('path-found');
    if (result.status !== 'path-found') return;
    const domaIndex = result.floorRegionIds.indexOf('region-doma');
    expect(domaIndex).toBeGreaterThanOrEqual(0);
    const domaPose = result.poses[domaIndex];
    if (!domaPose) throw new Error('Fallback path omitted its doma state');
    expect(
      Math.hypot(
        domaPose.position.x - restrictedGuide.positionXZ.x,
        domaPose.position.z - restrictedGuide.positionXZ.z,
      ),
    ).toBeGreaterThan(1e-8);

    const terminalApproachRegionId = house.guide
      .filter((guide) => guide.stage === 'upper-hall')
      .at(-1)?.floorRegionId;
    expect(result.floorRegionIds.at(-2)).toBe(terminalApproachRegionId);
    expect(result.floorRegionIds.at(-1)).toBe(house.goalRegionId);
    const approach = result.poses.at(-2);
    const goal = result.poses.at(-1);
    if (!approach || !goal) throw new Error('Missing locked terminal pair');
    expect(rotationAngle(approach.rotation, goal.rotation)).toBeLessThan(1e-8);
    expect(approach.position.y).toBe(goal.position.y);
    expect(
      transverseCoordinate(house.openings.ldk, approach.position),
    ).toBeCloseTo(transverseCoordinate(house.openings.ldk, goal.position), 8);

    for (let index = 1; index < result.poses.length; index++) {
      const before = result.poses[index - 1];
      const after = result.poses[index];
      const beforeFloor = result.floorRegionIds[index - 1];
      const afterFloor = result.floorRegionIds[index];
      if (!before || !after || !beforeFloor || !afterFloor)
        throw new Error('Missing fallback edge');
      expect(
        verifyModelMotion(
          query,
          { pose: before, floorRegionId: beforeFloor },
          { pose: after, floorRegionId: afterFloor },
        ).status,
      ).toBe('verified');
    }
  }, 30_000);

  it('reports node and time exhaustion without returning a partial route', async () => {
    const query = await modelQuery(snapshots.small);
    const nodeLimited = searchMaisonette(query, house, {
      ...options,
      maxNodes: 2,
    });
    expect(nodeLimited).toMatchObject({
      status: 'path-not-found',
      reason: 'node-limit',
    });

    let tick = 0;
    const timedOut = searchMaisonette(
      query,
      house,
      { ...options, maxTimeMs: 1 },
      undefined,
      () => tick++,
    );
    expect(timedOut).toMatchObject({
      status: 'path-not-found',
      reason: 'time-limit',
      nodesVisited: 0,
      queries: 0,
    });
  });

  it('does not invent a route for an item wider than the entry opening', async () => {
    const query = await modelQuery(snapshots.impossible);
    const result = searchMaisonette(query, house, options);
    expect(result).toMatchObject({
      status: 'path-not-found',
      reason: 'start-invalid',
      nodesVisited: 0,
      queries: 0,
    });
  }, 30_000);
});
