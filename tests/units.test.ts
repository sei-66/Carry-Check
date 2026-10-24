import { expect, it } from 'vitest';
import {
  metersToMillimeters,
  millimetersToMeters,
} from '../src/domain/dimensions';

it('converts in both directions without presentation rounding', () => {
  expect(millimetersToMeters(1000)).toBe(1);
  expect(metersToMillimeters(1)).toBe(1000);
  expect(metersToMillimeters(millimetersToMeters(600.123))).toBeCloseTo(
    600.123,
    10,
  );
  expect(() => millimetersToMeters(Infinity)).toThrow();
  expect(() => metersToMillimeters(NaN)).toThrow();
});
