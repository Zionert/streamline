export type FlowErrorCode = 'INVALID_ARGUMENT' | 'INVALID_TIME_ZONE';

/** Thrown when flow metric functions receive malformed arguments. */
export class FlowError extends Error {
  readonly code: FlowErrorCode;

  constructor(code: FlowErrorCode, message: string) {
    super(message);
    this.name = 'FlowError';
    this.code = code;
  }
}

/** Milliseconds in one (24-hour) day; durations in days are `ms / MS_PER_DAY`. */
export const MS_PER_DAY = 86_400_000;

/** Converts a duration in milliseconds to fractional days. */
export function msToDays(ms: number): number {
  return ms / MS_PER_DAY;
}

/** Throws {@link FlowError} unless `value` is a `Date` holding a valid instant. */
export function assertValidDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new FlowError('INVALID_ARGUMENT', `Invalid ${label}: expected a valid Date`);
  }
}

/** Throws {@link FlowError} unless `value` is a finite number. */
export function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FlowError('INVALID_ARGUMENT', `Invalid ${label}: expected a finite number`);
  }
}

/** Throws {@link FlowError} unless `value` is an integer in `[min, max]`. */
export function assertIntegerInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new FlowError(
      'INVALID_ARGUMENT',
      `Invalid ${label}: expected an integer between ${min} and ${max}`,
    );
  }
}
