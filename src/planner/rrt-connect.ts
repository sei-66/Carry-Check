import {
  distance,
  interpolatePose,
  normalizeQuaternion,
  rotationAngle,
  type Pose,
} from '../domain/pose';
import { NUMERICAL_ERROR_M, type PoseQuery } from '../geometry/query-types';
import { verifyMotion, verifyPath } from '../geometry/verify-motion';

export interface SearchOptions {
  readonly seed: number;
  readonly maxNodes: number;
  readonly maxTimeMs: number;
}

export interface SearchProblem {
  readonly start: Pose;
  readonly goal: Pose;
  readonly guides: readonly Pose[];
}

export type SearchResult =
  | {
      readonly status: 'path-found';
      readonly poses: readonly Pose[];
      readonly nodesVisited: number;
      readonly elapsedMs: number;
    }
  | {
      readonly status: 'path-not-found';
      readonly reason:
        | 'node-limit'
        | 'time-limit'
        | 'start-invalid'
        | 'goal-invalid'
        | 'verification-limit';
      readonly nodesVisited: number;
      readonly elapsedMs: number;
    };

interface Node {
  readonly pose: Pose;
  readonly parent: number | null;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function trace(tree: readonly Node[], index: number): Pose[] {
  const path: Pose[] = [];
  let cursor: number | null = index;
  while (cursor !== null) {
    const node: Node | undefined = tree[cursor];
    if (!node) throw new Error('Invalid search tree');
    path.push(node.pose);
    cursor = node.parent;
  }
  return path.reverse();
}

// M1 prototype: convex bounded space only; housing floor-region transitions are separate.
export function searchPath(
  query: PoseQuery,
  problem: SearchProblem,
  options: SearchOptions,
  onProgress: (
    nodesVisited: number,
    elapsedMs: number,
    stage: 'searching' | 'verifying',
  ) => void = () => {},
  clock: () => number = Date.now,
): SearchResult {
  if (
    !Number.isInteger(options.seed) ||
    options.seed < 0 ||
    options.seed > 0xffffffff ||
    !Number.isInteger(options.maxNodes) ||
    options.maxNodes < 2 ||
    options.maxNodes > 20000 ||
    !Number.isFinite(options.maxTimeMs) ||
    options.maxTimeMs < 1 ||
    options.maxTimeMs > 30000
  )
    throw new Error('Invalid search budget');
  const began = clock();
  let nodesVisited = 2;
  const elapsed = () => Math.max(0, clock() - began);
  const failure = (
    reason: Extract<SearchResult, { status: 'path-not-found' }>['reason'],
  ): SearchResult => ({
    status: 'path-not-found',
    reason,
    nodesVisited,
    elapsedMs: elapsed(),
  });
  const motionBudget = {
    maxDepth: 14,
    maxQueries: 512,
    shouldStop: () => elapsed() >= options.maxTimeMs,
  };
  if (query.query(problem.start, NUMERICAL_ERROR_M * 2).status !== 'clear')
    return failure('start-invalid');
  if (query.query(problem.goal, NUMERICAL_ERROR_M * 2).status !== 'clear')
    return failure('goal-invalid');
  const finish = (poses: readonly Pose[]): SearchResult => {
    onProgress(nodesVisited, elapsed(), 'verifying');
    if (elapsed() >= options.maxTimeMs) return failure('time-limit');
    // New queries revalidate every edge, even those already accepted during exploration.
    const result = verifyPath(query, poses, {
      maxDepth: 18,
      maxQueries: 8192,
      shouldStop: motionBudget.shouldStop,
    });
    if (elapsed() >= options.maxTimeMs) return failure('time-limit');
    if (result.status !== 'verified') return failure('verification-limit');
    return { status: 'path-found', poses, nodesVisited, elapsedMs: elapsed() };
  };
  if (
    verifyMotion(query, problem.start, problem.goal, motionBudget).status ===
    'verified'
  )
    return finish([problem.start, problem.goal]);
  const random = seededRandom(options.seed);
  let first: Node[] = [{ pose: problem.start, parent: null }];
  let second: Node[] = [{ pose: problem.goal, parent: null }];
  let firstIsStart = true;
  const metric = (a: Pose, b: Pose) =>
    distance(a.position, b.position) +
    query.radius * rotationAngle(a.rotation, b.rotation);
  const extend = (
    tree: Node[],
    target: Pose,
  ): { index: number; reached: boolean } | null => {
    if (nodesVisited >= options.maxNodes || elapsed() >= options.maxTimeMs)
      return null;
    let index = 0;
    let nearest = Infinity;
    for (let i = 0; i < tree.length; i++) {
      const node = tree[i];
      if (!node) continue;
      const value = metric(node.pose, target);
      if (value < nearest) {
        nearest = value;
        index = i;
      }
    }
    const node = tree[index];
    if (!node) throw new Error('Missing node');
    if (nearest < 1e-10) return { index, reached: true };
    const fraction = Math.min(
      1,
      0.35 / Math.max(1e-12, distance(node.pose.position, target.position)),
      Math.PI /
        10 /
        Math.max(1e-12, rotationAngle(node.pose.rotation, target.rotation)),
    );
    const next = interpolatePose(node.pose, target, fraction);
    const validation = verifyMotion(query, node.pose, next, motionBudget);
    if (validation.status !== 'verified') return null;
    tree.push({ pose: next, parent: index });
    nodesVisited++;
    return { index: tree.length - 1, reached: fraction === 1 };
  };
  const sample = (): Pose => {
    if (random() < 0.15) return firstIsStart ? problem.goal : problem.start;
    if (problem.guides.length && random() < 0.55) {
      const guide =
        problem.guides[Math.floor(random() * problem.guides.length)];
      if (guide) return guide;
    }
    const u = random();
    const v = 2 * Math.PI * random();
    const w = 2 * Math.PI * random();
    return {
      position: {
        x:
          query.bounds.min.x +
          random() * (query.bounds.max.x - query.bounds.min.x),
        y:
          query.bounds.min.y +
          random() * (query.bounds.max.y - query.bounds.min.y),
        z:
          query.bounds.min.z +
          random() * (query.bounds.max.z - query.bounds.min.z),
      },
      rotation: normalizeQuaternion({
        x: Math.sqrt(1 - u) * Math.sin(v),
        y: Math.sqrt(1 - u) * Math.cos(v),
        z: Math.sqrt(u) * Math.sin(w),
        w: Math.sqrt(u) * Math.cos(w),
      }),
    };
  };
  // Failed extensions consume the attempt budget too, preventing a no-growth loop.
  let attempts = 0;
  while (nodesVisited < options.maxNodes && attempts < options.maxNodes) {
    if (elapsed() >= options.maxTimeMs) return failure('time-limit');
    attempts++;
    if (attempts % 32 === 0) onProgress(nodesVisited, elapsed(), 'searching');
    const grown = extend(first, sample());
    if (grown) {
      const target = first[grown.index]?.pose;
      if (!target) throw new Error('Missing target');
      let connection = extend(second, target);
      while (connection && !connection.reached)
        connection = extend(second, target);
      if (connection?.reached) {
        const left = trace(first, grown.index);
        const right = trace(second, connection.index);
        const poses = firstIsStart
          ? [...left, ...right.reverse().slice(1)]
          : [...right, ...left.reverse().slice(1)];
        return finish(poses);
      }
    }
    [first, second] = [second, first];
    firstIsStart = !firstIsStart;
  }
  return failure(elapsed() >= options.maxTimeMs ? 'time-limit' : 'node-limit');
}
