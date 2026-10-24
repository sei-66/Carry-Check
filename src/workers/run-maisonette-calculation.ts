import type { ModelQuery } from '../geometry/model-query';
import { evaluatePathClearance } from '../geometry/path-clearance';
import type { MaisonetteModel } from '../model/maisonette-model';
import {
  searchMaisonette,
  MAX_MAISONETTE_QUERIES,
} from '../planner/maisonette-search';
import type {
  CalculationOptions,
  PathFoundResult,
  PathNotFoundResult,
} from '../shared/calculation-messages';

export function runMaisonetteCalculation(
  query: ModelQuery,
  house: MaisonetteModel,
  options: CalculationOptions,
  onProgress: (
    nodesVisited: number,
    elapsedMs: number,
    stage: 'searching' | 'verifying',
  ) => void,
  clock: () => number = Date.now,
): PathFoundResult | PathNotFoundResult {
  const began = clock();
  const search = searchMaisonette(query, house, options, onProgress, clock);
  if (search.status !== 'path-found')
    return {
      status: search.status,
      reason: search.reason,
      seed: options.seed,
      nodesVisited: search.nodesVisited,
      elapsedMs: search.elapsedMs,
    };
  const evaluated = evaluatePathClearance(query.packed, search.poses, {
    maxQueries: Math.max(0, MAX_MAISONETTE_QUERIES - search.queries),
    maxTimeMs: Math.max(0, options.maxTimeMs - (clock() - began)),
    clock,
  });
  return {
    status: 'path-found',
    poses: search.poses,
    floorRegionIds: search.floorRegionIds,
    clearance: evaluated.clearance,
    seed: options.seed,
    nodesVisited: search.nodesVisited,
    elapsedMs: Math.max(0, clock() - began),
  };
}
