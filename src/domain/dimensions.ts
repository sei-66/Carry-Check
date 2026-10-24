export interface RawDimensions {
  readonly widthMm: string;
  readonly depthMm: string;
  readonly heightMm: string;
  readonly marginMm: string;
}

export interface InputSnapshot {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly marginMm: number;
}

export interface DimensionsInMeters {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ValidatedDimensions {
  readonly snapshot: InputSnapshot;
  readonly packed: DimensionsInMeters;
  readonly clearance: DimensionsInMeters;
}

export type DimensionField = keyof RawDimensions;

export type DimensionValidationResult =
  | { readonly ok: true; readonly value: ValidatedDimensions }
  | {
      readonly ok: false;
      readonly errors: Readonly<Partial<Record<DimensionField, string>>>;
    };

const DECIMAL_PATTERN = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const MIN_LENGTH_MM = 1;
const MAX_LENGTH_MM = 5000;
const MIN_MARGIN_MM = 5;
const MAX_MARGIN_MM = 100;

function parseDecimal(value: string): number | undefined {
  if (!DECIMAL_PATTERN.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function lengthError(value: string): string | undefined {
  const parsed = parseDecimal(value);
  if (parsed === undefined) return '1〜5000 mm の数値を入力してください。';
  if (parsed < MIN_LENGTH_MM || parsed > MAX_LENGTH_MM)
    return '1〜5000 mm の範囲で入力してください。';
  return undefined;
}

function marginError(value: string): string | undefined {
  const parsed = parseDecimal(value);
  if (parsed === undefined) return '5〜100 mm の数値を入力してください。';
  if (parsed < MIN_MARGIN_MM || parsed > MAX_MARGIN_MM)
    return '5〜100 mm の範囲で入力してください。';
  return undefined;
}

export function millimetersToMeters(valueMm: number): number {
  if (!Number.isFinite(valueMm)) throw new Error('Invalid length');
  return valueMm / 1000;
}

export function metersToMillimeters(valueM: number): number {
  if (!Number.isFinite(valueM)) throw new Error('Invalid length');
  return valueM * 1000;
}

export function validateDimensions(
  raw: RawDimensions,
): DimensionValidationResult {
  const errors: Partial<Record<DimensionField, string>> = {};
  const width = parseDecimal(raw.widthMm);
  const depth = parseDecimal(raw.depthMm);
  const height = parseDecimal(raw.heightMm);
  const margin = parseDecimal(raw.marginMm);

  const widthMessage = lengthError(raw.widthMm);
  const depthMessage = lengthError(raw.depthMm);
  const heightMessage = lengthError(raw.heightMm);
  const marginMessage = marginError(raw.marginMm);
  if (widthMessage) errors.widthMm = widthMessage;
  if (depthMessage) errors.depthMm = depthMessage;
  if (heightMessage) errors.heightMm = heightMessage;
  if (marginMessage) errors.marginMm = marginMessage;

  if (
    widthMessage ||
    depthMessage ||
    heightMessage ||
    marginMessage ||
    width === undefined ||
    depth === undefined ||
    height === undefined ||
    margin === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: validateNumericDimensions(width, depth, height, margin),
  };
}

export function validateInputSnapshot(
  snapshot: InputSnapshot,
): DimensionValidationResult {
  const errors: Partial<Record<DimensionField, string>> = {};
  const widthMessage = numericLengthError(snapshot.widthMm);
  const depthMessage = numericLengthError(snapshot.depthMm);
  const heightMessage = numericLengthError(snapshot.heightMm);
  const marginMessage = numericMarginError(snapshot.marginMm);
  if (widthMessage) errors.widthMm = widthMessage;
  if (depthMessage) errors.depthMm = depthMessage;
  if (heightMessage) errors.heightMm = heightMessage;
  if (marginMessage) errors.marginMm = marginMessage;
  if (widthMessage || depthMessage || heightMessage || marginMessage)
    return { ok: false, errors };

  return {
    ok: true,
    value: validateNumericDimensions(
      snapshot.widthMm,
      snapshot.depthMm,
      snapshot.heightMm,
      snapshot.marginMm,
    ),
  };
}

function numericLengthError(value: number): string | undefined {
  if (!Number.isFinite(value)) return '1〜5000 mm の数値を入力してください。';
  if (value < MIN_LENGTH_MM || value > MAX_LENGTH_MM)
    return '1〜5000 mm の範囲で入力してください。';
  return undefined;
}

function numericMarginError(value: number): string | undefined {
  if (!Number.isFinite(value)) return '5〜100 mm の数値を入力してください。';
  if (value < MIN_MARGIN_MM || value > MAX_MARGIN_MM)
    return '5〜100 mm の範囲で入力してください。';
  return undefined;
}

function validateNumericDimensions(
  width: number,
  depth: number,
  height: number,
  margin: number,
): ValidatedDimensions {
  return {
    snapshot: {
      widthMm: width,
      depthMm: depth,
      heightMm: height,
      marginMm: margin,
    },
    packed: {
      x: millimetersToMeters(width),
      y: millimetersToMeters(height),
      z: millimetersToMeters(depth),
    },
    clearance: {
      x: millimetersToMeters(width + 2 * margin),
      y: millimetersToMeters(height + 2 * margin),
      z: millimetersToMeters(depth + 2 * margin),
    },
  };
}
