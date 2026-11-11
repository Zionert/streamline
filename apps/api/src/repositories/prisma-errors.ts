import { Prisma } from '../generated/prisma/client.js';

/** Prisma error codes the repositories translate into domain results. */
export const PRISMA_ERROR = {
  UNIQUE_CONSTRAINT_VIOLATION: 'P2002',
  FOREIGN_KEY_VIOLATION: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
  /** Interactive transaction API error, e.g. not started within `maxWait` or expired. */
  TRANSACTION_API_ERROR: 'P2028',
} as const;

export type PrismaErrorCode = (typeof PRISMA_ERROR)[keyof typeof PRISMA_ERROR];

export function isPrismaError(
  err: unknown,
  code: PrismaErrorCode,
): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/** PostgreSQL SQLSTATE codes the repositories react to. */
export const PG_ERROR = {
  /** `lock_not_available`, raised e.g. when `lock_timeout` expires. */
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Details of the database error reported by the driver adapter, if any. */
function driverErrorCause(err: Prisma.PrismaClientKnownRequestError): unknown {
  return property(property(err.meta, 'driverAdapterError'), 'cause');
}

/** SQLSTATE of the underlying PostgreSQL error, whatever Prisma code wraps it. */
export function postgresErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const cause = driverErrorCause(err);
  const code = property(cause, 'originalCode') ?? property(cause, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * Whether `err` is a unique violation (`P2002`) of the given constraint. Depending on the engine
 * or adapter, Prisma reports the constraint as its name or as its fields, either in
 * `meta.target` or in the driver adapter's error, so every form is accepted.
 */
export function isUniqueViolationOf(
  err: unknown,
  constraint: { name: string; fields: readonly string[] },
): boolean {
  if (!isPrismaError(err, PRISMA_ERROR.UNIQUE_CONSTRAINT_VIOLATION)) return false;
  const matches = (value: unknown): boolean =>
    value === constraint.name ||
    (Array.isArray(value) &&
      value.length === constraint.fields.length &&
      constraint.fields.every((field) => value.includes(field)));

  const reported = property(driverErrorCause(err), 'constraint');
  return (
    matches(property(err.meta, 'target')) ||
    matches(property(reported, 'index')) ||
    matches(property(reported, 'fields'))
  );
}
