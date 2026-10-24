import { describe, expect, it } from 'vitest';
import {
  validateDimensions,
  validateInputSnapshot,
} from '../src/domain/dimensions';

describe('validateDimensions', () => {
  it('converts mm to m and expands every face by the safety margin', () => {
    const result = validateDimensions({
      widthMm: '600',
      depthMm: '1200',
      heightMm: '800',
      marginMm: '10',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        snapshot: {
          widthMm: 600,
          depthMm: 1200,
          heightMm: 800,
          marginMm: 10,
        },
        packed: { x: 0.6, y: 0.8, z: 1.2 },
        clearance: { x: 0.62, y: 0.82, z: 1.22 },
      },
    });
  });

  it('accepts decimal dimensions and the minimum margin', () => {
    const result = validateDimensions({
      widthMm: '1.25',
      depthMm: '1.5',
      heightMm: '5000',
      marginMm: '5',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.packed).toEqual({ x: 0.00125, y: 5, z: 0.0015 });
      expect(result.value.clearance).toEqual({
        x: 0.01125,
        y: 5.01,
        z: 0.0115,
      });
    }
  });

  it.each([
    '',
    ' ',
    ' 12',
    '12 ',
    '0x10',
    '-1',
    '+1',
    'NaN',
    'Infinity',
    '1e2',
  ])('rejects invalid numeric text %j', (value) => {
    const result = validateDimensions({
      widthMm: value,
      depthMm: '100',
      heightMm: '100',
      marginMm: '5',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.widthMm).toBeDefined();
  });

  it.each([
    ['widthMm', '0'],
    ['depthMm', '5000.01'],
    ['heightMm', '-2'],
    ['marginMm', '100.01'],
  ] as const)('rejects out-of-range %s', (field, value) => {
    const raw = {
      widthMm: '100',
      depthMm: '100',
      heightMm: '100',
      marginMm: '5',
      [field]: value,
    };
    const result = validateDimensions(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[field]).toBeDefined();
  });

  it('revalidates snapshots received across the worker boundary', () => {
    expect(
      validateInputSnapshot({
        widthMm: 500,
        depthMm: 600,
        heightMm: 700,
        marginMm: 5,
      }).ok,
    ).toBe(true);
    expect(
      validateInputSnapshot({
        widthMm: 500,
        depthMm: 600,
        heightMm: 700,
        marginMm: Number.POSITIVE_INFINITY,
      }).ok,
    ).toBe(false);
    const tinyMargin = validateInputSnapshot({
      widthMm: 500,
      depthMm: 600,
      heightMm: 700,
      marginMm: 0.0000001,
    });
    expect(tinyMargin).toEqual({
      ok: false,
      errors: { marginMm: '5〜100 mm の範囲で入力してください。' },
    });
  });

  it.each([5, 5.5, 100])(
    'accepts margin %s mm for UI and worker inputs',
    (marginMm) => {
      expect(
        validateDimensions({
          widthMm: '500',
          depthMm: '600',
          heightMm: '700',
          marginMm: String(marginMm),
        }).ok,
      ).toBe(true);
      expect(
        validateInputSnapshot({
          widthMm: 500,
          depthMm: 600,
          heightMm: 700,
          marginMm,
        }).ok,
      ).toBe(true);
    },
  );

  it.each([0, 4.99, 100.01])(
    'rejects margin %s mm for UI and worker inputs',
    (marginMm) => {
      const expected = {
        ok: false,
        errors: { marginMm: '5〜100 mm の範囲で入力してください。' },
      };
      expect(
        validateDimensions({
          widthMm: '500',
          depthMm: '600',
          heightMm: '700',
          marginMm: String(marginMm),
        }),
      ).toEqual(expected);
      expect(
        validateInputSnapshot({
          widthMm: 500,
          depthMm: 600,
          heightMm: 700,
          marginMm,
        }),
      ).toEqual(expected);
    },
  );
});
