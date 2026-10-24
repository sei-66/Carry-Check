import { IDENTITY, type Pose } from '../domain/pose';
import { verifyModelMotion, type FloorState } from '../geometry/floor-motion';
import {
  createModelQuery,
  footprintLocation,
  type ModelQuery,
} from '../geometry/model-query';
import { NUMERICAL_ERROR_M, type PoseQuery } from '../geometry/query-types';
import {
  createPhysicalQuery,
  type PhysicalQueryOptions,
} from '../geometry/physical-query';
import { createRapierDiagnosticFactory } from '../geometry/rapier-diagnostic-factory';
import { createDistanceProbes } from './fixtures/distance-probes';
import { searchPath } from '../planner/rrt-connect';
import {
  createTurnFixture,
  TURN_FIXTURE_DIMENSIONS,
  TURN_FIXTURE_ID,
} from './fixtures/turn-fixture';

const pose = (x: number, y: number, z: number): Pose => ({
  position: { x, y, z },
  rotation: IDENTITY,
});
// Independent known local motion, not a target-home route or a user option.
export const M1_REFERENCE_STATES: readonly FloorState[] = [
  { floorRegionId: 'region-F0', pose: pose(-0.4, 0.35, -0.15) },
  { floorRegionId: 'region-P1', pose: pose(-0.4, 0.55, 0.1) },
  { floorRegionId: 'region-P1', pose: pose(-0.45, 0.65, 0.3) },
  { floorRegionId: 'region-P2', pose: pose(-0.35, 0.8, 0.55) },
  { floorRegionId: 'region-P3', pose: pose(0.3, 1, 0.55) },
  { floorRegionId: 'region-P4', pose: pose(0.4, 1.1, 0.1) },
  { floorRegionId: 'region-F5', pose: pose(0.4, 1.2, -0.15) },
];
export const M1_SEARCH_OPTIONS = {
  seed: 20261003,
  maxNodes: 600,
  maxTimeMs: 3000,
} as const;
const m1DiagnosticOptions: PhysicalQueryOptions = {
  diagnosticFactory: createRapierDiagnosticFactory,
};

// The prototype has no unverified endpoint type. Reject an uncertain candidate
// in this verification-only adapter, then retain independent final proof.
export function createM1CandidateQuery(query: ModelQuery): PoseQuery {
  return {
    ...query.motionQuery,
    query(pose, predictionM) {
      try {
        return query.motionQuery.query(pose, predictionM);
      } catch {
        return {
          status: 'blocked',
          lowerBoundM: 0,
          upperBoundM: null,
          obstacleId: 'constraint-query-unverified',
        };
      }
    },
  };
}

export async function prepareM1Benchmark() {
  const model = createTurnFixture();
  const query = await createModelQuery(
    model,
    TURN_FIXTURE_DIMENSIONS,
    m1DiagnosticOptions,
  );
  const p1 = model.physicalSolids[1];
  if (!p1) throw new Error('Missing P1');
  const shifted = {
    ...p1,
    footprint: p1.footprint.map((p) => ({ x: p.x - 15, z: p.z })),
    bottomM: p1.bottomM - 15,
    topM: p1.topM - 15,
  };
  const probe = await createPhysicalQuery(
    [shifted],
    {
      x: 0.05,
      y: 0.05,
      z: 0.05,
    },
    m1DiagnosticOptions,
  );
  const distanceProbes = await Promise.all(
    createDistanceProbes().map(async (probe) => ({
      ...probe,
      query: await createPhysicalQuery(
        [probe.solid],
        probe.dimensions,
        m1DiagnosticOptions,
      ),
    })),
  );
  return {
    run() {
      const angle = 0.3;
      const probePose = {
        ...pose(
          -15.4,
          shifted.topM + 0.025 * (Math.cos(angle) + Math.sin(angle)) + 0.0001,
          0.1,
        ),
        rotation: {
          x: Math.sin(angle / 2),
          y: 0,
          z: 0,
          w: Math.cos(angle / 2),
        },
      };
      const probeResult = probe.query(probePose, 1);
      if (probeResult.status === 'clear')
        throw new Error('Micro-gap incorrectly certified');
      const gap = query.query(pose(-0.4, 0.35, 0.02), 'region-P1', 1);
      const covers = (lo: number, hi: number | null, expected: number) =>
        lo <= expected && hi !== null && hi >= expected;
      if (
        !covers(gap.packed.lowerBoundM, gap.packed.upperBoundM, 0.12) ||
        !covers(gap.clearance.lowerBoundM, gap.clearance.upperBoundM, 0.11)
      )
        throw new Error('Analytical M1 distance mismatch');
      const distanceRefinementProbes = distanceProbes.map((probe) => {
        const result = probe.query.query(probe.pose, 1);
        if (
          !covers(result.lowerBoundM, result.upperBoundM, probe.expectedM) ||
          result.upperBoundM === null ||
          result.upperBoundM - result.lowerBoundM >= 0.001 ||
          result.status !== 'clear'
        )
          throw new Error(`Distance refinement failed: ${probe.id}`);
        return {
          id: probe.id,
          expectedM: probe.expectedM,
          dimensionsM: probe.dimensions,
          result,
          scope: 'Independent mathematical distance probe, not a housing shape',
        };
      });
      const reference = M1_REFERENCE_STATES.slice(1).map((end, i) => {
        const start = M1_REFERENCE_STATES[i];
        if (!start) throw new Error('Missing reference start');
        return verifyModelMotion(query, start, end);
      });
      if (reference.some((r) => r.status !== 'verified'))
        throw new Error('Reference M1 motion not verified');
      const started = M1_REFERENCE_STATES[0],
        ended = M1_REFERENCE_STATES[M1_REFERENCE_STATES.length - 1];
      if (!started || !ended) throw new Error('Missing reference endpoints');
      // The existing M1 prototype searches only physical solids and the outer
      // bounds. Its candidate is NOT a housing/floor-aware search result.
      const search = searchPath(
        createM1CandidateQuery(query),
        {
          start: started.pose,
          goal: ended.pose,
          guides: M1_REFERENCE_STATES.map((s) => s.pose),
        },
        M1_SEARCH_OPTIONS,
        undefined,
        () => performance.now(),
      );
      const candidateChecks =
        search.status === 'path-found'
          ? search.poses.slice(1).map((end, i) => {
              const start = search.poses[i];
              if (!start)
                return {
                  status: 'unverified',
                  reason: 'missing-pose',
                } as const;
              const from = model.floorRegions.filter(
                (r) =>
                  footprintLocation(r.footprint, start.position) === 'inside',
              );
              const to = model.floorRegions.filter(
                (r) =>
                  footprintLocation(r.footprint, end.position) === 'inside',
              );
              if (from.length !== 1 || to.length !== 1 || !from[0] || !to[0])
                return {
                  status: 'unverified',
                  reason: 'floor-assignment',
                } as const;
              return verifyModelMotion(
                query,
                { pose: start, floorRegionId: from[0].id },
                { pose: end, floorRegionId: to[0].id },
              );
            })
          : [];
      return {
        fixtureId: TURN_FIXTURE_ID,
        engine: '@dimforge/rapier3d-compat@0.21.0',
        dimensions: TURN_FIXTURE_DIMENSIONS.snapshot,
        numericalErrorM: NUMERICAL_ERROR_M,
        precisionProbe: {
          analyticalGapM: 0.0001,
          predictionM: 1,
          result: probeResult,
          rapierSoleSafetyOracle: 'not-adopted',
        },
        distanceRefinementProbes,
        referenceMotion: reference,
        analyticalDistance: {
          packedExpectedM: 0.12,
          clearanceExpectedM: 0.11,
          packed: gap.packed,
          clearance: gap.clearance,
        },
        search: {
          ...search,
          scope: 'physical-and-outer-candidate-only',
          options: M1_SEARCH_OPTIONS,
        },
        candidateFloorVerification: {
          status:
            search.status === 'path-found' &&
            candidateChecks.every((r) => r.status === 'verified')
              ? 'verified'
              : 'unverified',
          checks: candidateChecks,
        },
        scope:
          'Independent local fixture. Target home, LDK opening and floor-aware planner are not implemented.',
      };
    },
  };
}
