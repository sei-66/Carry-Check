import { interpolatePose, pointMotionBound, type Pose } from '../domain/pose';
import { NUMERICAL_ERROR_M, type PoseQuery } from './query-types';

export interface VerificationOptions {
  readonly maxDepth: number;
  readonly maxQueries: number;
  readonly shouldStop?: () => boolean;
}

export type MotionVerification =
  | { readonly status: 'verified'; readonly queries: number }
  | {
      readonly status: 'blocked';
      readonly queries: number;
      readonly pose: Pose;
      readonly obstacleId: string;
    }
  | {
      readonly status: 'unverified';
      readonly queries: number;
      readonly reason: 'budget' | 'query-failed';
    };

export const DEFAULT_VERIFICATION: VerificationOptions = {
  maxDepth: 18,
  maxQueries: 8192,
};

export function verifyMotion(
  query: PoseQuery,
  start: Pose,
  end: Pose,
  options: VerificationOptions = DEFAULT_VERIFICATION,
): MotionVerification {
  if (
    !Number.isInteger(options.maxDepth) ||
    options.maxDepth < 0 ||
    options.maxDepth > 24 ||
    !Number.isInteger(options.maxQueries) ||
    options.maxQueries < 1 ||
    options.maxQueries > 100000
  )
    throw new Error('Invalid verification budget');
  let queries = 0;
  const visit = (a: Pose, b: Pose, depth: number): MotionVerification => {
    const movement = pointMotionBound(a, b, query.radius);
    if (queries + 2 > options.maxQueries || options.shouldStop?.())
      return { status: 'unverified', queries, reason: 'budget' };
    let first;
    let last;
    try {
      queries++;
      first = query.query(a, movement + 2 * NUMERICAL_ERROR_M);
      queries++;
      last = query.query(b, 2 * NUMERICAL_ERROR_M);
    } catch {
      return { status: 'unverified', queries, reason: 'query-failed' };
    }
    if (first.status === 'blocked')
      return {
        status: 'blocked',
        queries,
        pose: a,
        obstacleId: first.obstacleId,
      };
    if (last.status === 'blocked')
      return {
        status: 'blocked',
        queries,
        pose: b,
        obstacleId: last.obstacleId,
      };
    if (first.lowerBoundM > movement) return { status: 'verified', queries };
    if (query.sweepLowerBound) {
      if (queries + 1 > options.maxQueries || options.shouldStop?.())
        return { status: 'unverified', queries, reason: 'budget' };
      try {
        queries++;
        const lower = query.sweepLowerBound(a, b);
        if (!Number.isFinite(lower))
          throw new Error('Invalid sweep lower bound');
        if (lower > 0) return { status: 'verified', queries };
      } catch {
        return { status: 'unverified', queries, reason: 'query-failed' };
      }
    }
    if (depth >= options.maxDepth)
      return { status: 'unverified', queries, reason: 'budget' };
    const middle = interpolatePose(a, b, 0.5);
    const left = visit(a, middle, depth + 1);
    if (left.status !== 'verified') return left;
    return visit(middle, b, depth + 1);
  };
  try {
    const result = visit(start, end, 0);
    return { ...result, queries };
  } catch {
    return { status: 'unverified', queries, reason: 'query-failed' };
  }
}

export function verifyPath(
  query: PoseQuery,
  poses: readonly Pose[],
  options: VerificationOptions = DEFAULT_VERIFICATION,
): MotionVerification {
  if (poses.length < 2)
    return { status: 'unverified', queries: 0, reason: 'query-failed' };
  let queries = 0;
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1];
    const b = poses[i];
    if (!a || !b) throw new Error('Invalid path');
    const remaining = options.maxQueries - queries;
    if (remaining < 2 || options.shouldStop?.())
      return { status: 'unverified', queries, reason: 'budget' };
    const result = verifyMotion(query, a, b, {
      ...options,
      maxQueries: remaining,
    });
    queries += result.queries;
    if (result.status !== 'verified') return { ...result, queries };
  }
  return { status: 'verified', queries };
}
