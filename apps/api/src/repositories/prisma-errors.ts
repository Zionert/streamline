import { Prisma } from '../generated/prisma/client.js';

/** Prisma error codes the repositories translate into domain results. */
export const PRISMA_ERROR = {
  UNIQUE_CONSTRAINT_VIOLATION: 'P2002',
  FOREIGN_KEY_VIOLATION: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
} as const;

export type PrismaErrorCode = (typeof PRISMA_ERROR)[keyof typeof PRISMA_ERROR];

export function isPrismaError(err: unknown, code: PrismaErrorCode): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}
