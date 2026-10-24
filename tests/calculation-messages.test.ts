import { describe, expect, it } from 'vitest';
import {
  isCalculationRequest,
  isInputSnapshot,
} from '../src/shared/calculation-messages';
import { FIXED_ROUTE_METADATA } from '../src/shared/fixed-route';

const request = {
  type: 'calculate',
  requestId: 'request-1',
  ...FIXED_ROUTE_METADATA,
  input: { widthMm: 500, depthMm: 600, heightMm: 700, marginMm: 10 },
  options: { seed: 1, maxNodes: 100, maxTimeMs: 1000 },
};

describe('calculation message guards', () => {
  it('accepts only finite numeric input snapshots', () => {
    expect(isInputSnapshot(request.input)).toBe(true);
    expect(isInputSnapshot({ ...request.input, widthMm: Number.NaN })).toBe(
      false,
    );
    expect(
      isInputSnapshot({ ...request.input, marginMm: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });

  it('requires the fixed route, direction, and contract version', () => {
    expect(isCalculationRequest(request)).toBe(true);
    expect(isCalculationRequest({ ...request, routeId: 'other-route' })).toBe(
      false,
    );
    expect(
      isCalculationRequest({ ...request, direction: 'room-to-entry' }),
    ).toBe(false);
    expect(
      isCalculationRequest({ ...request, modelVersion: 'future-v2' }),
    ).toBe(false);
    expect(
      isCalculationRequest({
        ...request,
        modelVersion: 'maisonette-assumed-v2',
      }),
    ).toBe(false);
    expect(isCalculationRequest({ ...request, scenarioId: 'straight' })).toBe(
      false,
    );
  });
});
