import { interpolatePose, pointMotionBound, type Pose } from '../domain/pose';
import type { FoundClearance } from '../shared/calculation-messages';
import type { PhysicalQuery } from './physical-query';

interface Sample {
  readonly pose: Pose;
  readonly lower: number;
  readonly upper: number;
}
interface Interval {
  readonly start: Sample;
  readonly end: Sample;
  readonly lower: number;
  readonly segmentIndex: number;
  readonly startT: number;
  readonly endT: number;
}

/** Global minimum over the playback's continuous lerp/slerp path. Physical
 * geometry only: floor/lift/receiver/outer constraints are not obstacles. */
export function evaluatePathClearance(
  query: PhysicalQuery,
  poses: readonly Pose[],
  options: {
    readonly maxQueries: number;
    readonly maxTimeMs: number;
    readonly clock?: () => number;
  },
): { readonly clearance: FoundClearance | null; readonly queries: number } {
  if (
    !Number.isSafeInteger(options.maxQueries) ||
    options.maxQueries < 0 ||
    options.maxQueries > 100_000 ||
    !Number.isFinite(options.maxTimeMs) ||
    options.maxTimeMs < 0 ||
    poses.length < 2
  )
    throw new Error('Invalid clearance budget');
  const clock = options.clock ?? Date.now;
  const began = clock();
  let queries = 0;
  let upper = Infinity;
  let attention: FoundClearance['attention'] | undefined;
  const deadlineReached = () => clock() - began >= options.maxTimeMs;
  const stopped = () => queries >= options.maxQueries || deadlineReached();
  const incomplete = () => ({ clearance: null, queries });
  const sample = (
    pose: Pose,
    segmentIndex: number,
    fraction: number,
  ): Sample | null => {
    if (stopped()) return null;
    queries++;
    const distance = query.query(pose, 100);
    if (deadlineReached()) return null;
    if (
      distance.upperBoundM === null ||
      !Number.isFinite(distance.lowerBoundM) ||
      !Number.isFinite(distance.upperBoundM) ||
      distance.lowerBoundM < 0 ||
      distance.lowerBoundM > distance.upperBoundM
    )
      return null;
    if (distance.upperBoundM < upper) {
      upper = distance.upperBoundM;
      attention = {
        segmentIndex,
        fraction,
        pose,
        obstacleId: distance.obstacleId,
      };
    }
    return { pose, lower: distance.lowerBoundM, upper: distance.upperBoundM };
  };
  const interval = (
    start: Sample,
    end: Sample,
    segmentIndex: number,
    startT: number,
    endT: number,
  ): Interval => {
    let lower = Math.max(
      0,
      Math.max(start.lower, end.lower) -
        pointMotionBound(start.pose, end.pose, query.radius),
    );
    if (query.sweepLowerBound) {
      if (stopped()) throw new Error('Clearance sweep budget');
      queries++;
      const swept = query.sweepLowerBound(start.pose, end.pose);
      if (deadlineReached()) throw new Error('Clearance sweep deadline');
      if (
        !Number.isFinite(swept) ||
        swept < 0 ||
        swept > Math.min(start.upper, end.upper)
      )
        throw new Error('Invalid clearance sweep bound');
      lower = Math.max(lower, swept);
    }
    return { start, end, lower, segmentIndex, startT, endT };
  };
  try {
    const samples: Sample[] = [];
    for (const [index, pose] of poses.entries()) {
      const value = sample(pose, Math.max(0, index - 1), index === 0 ? 0 : 1);
      if (!value) return incomplete();
      samples.push(value);
    }
    const leaves: Interval[] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      if (!a || !b) throw new Error('Missing path sample');
      leaves.push(interval(a, b, i - 1, 0, 1));
    }
    for (;;) {
      if (deadlineReached()) return incomplete();
      let limiting = 0;
      let lower = Infinity;
      for (let i = 0; i < leaves.length; i++) {
        const leaf = leaves[i];
        if (leaf && leaf.lower < lower) {
          lower = leaf.lower;
          limiting = i;
        }
      }
      // Reserve .1mm of outward rounding at each displayed endpoint, keeping
      // the reported interval within 1mm rather than rounding it inward.
      if (deadlineReached()) return incomplete();
      if (upper - lower <= 0.0008 && attention)
        return {
          clearance: {
            lowerBoundM: lower,
            upperBoundM: upper,
            obstacleId: null,
            attention,
          },
          queries,
        };
      if (stopped()) return incomplete();
      const leaf = leaves[limiting];
      if (!leaf) throw new Error('Missing interval');
      const middle = sample(
        interpolatePose(leaf.start.pose, leaf.end.pose, 0.5),
        leaf.segmentIndex,
        (leaf.startT + leaf.endT) / 2,
      );
      if (!middle) return incomplete();
      // Distance to a fixed solid is 1-Lipschitz in the maximum moving-point
      // displacement. End witnesses give the upper bound, never the lower.
      leaves.splice(
        limiting,
        1,
        interval(
          leaf.start,
          middle,
          leaf.segmentIndex,
          leaf.startT,
          (leaf.startT + leaf.endT) / 2,
        ),
        interval(
          middle,
          leaf.end,
          leaf.segmentIndex,
          (leaf.startT + leaf.endT) / 2,
          leaf.endT,
        ),
      );
    }
  } catch {
    return incomplete();
  }
}
