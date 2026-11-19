import type { AiUsage } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';
import { isPrismaError, PRISMA_ERROR } from './prisma-errors.js';

export type AiUsageRecord = AiUsage;

export interface AiDailyLimits {
  requests: number;
  tokens: number;
}

export type ReserveRequestResult =
  | { status: 'reserved' }
  /** The daily limit that is used up (nothing was counted). */
  | { status: 'limit-reached'; limit: 'requests' | 'tokens' };

export interface AiTokenIncrement {
  promptTokens: number;
  completionTokens: number;
}

/** Assistant usage per user and UTC day (`day` is the date at UTC midnight). */
export interface AiUsageRepository {
  /**
   * Counts one more request of the user on the day unless a daily limit is already used up.
   * The request counter is checked and incremented in one statement, so concurrent requests
   * never exceed the request limit; tokens are only added after the fact, so the token limit
   * blocks the requests started after it was reached.
   */
  reserveRequest(userId: string, day: Date, limits: AiDailyLimits): Promise<ReserveRequestResult>;
  /** Adds spent tokens to the user's usage on the day (atomic increments). */
  addTokens(userId: string, day: Date, tokens: AiTokenIncrement): Promise<void>;
  find(userId: string, day: Date): Promise<AiUsageRecord | null>;
}

/** Runs an upsert again when a parallel request created the same row first. */
async function retryOnUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (isPrismaError(err, PRISMA_ERROR.UNIQUE_CONSTRAINT_VIOLATION)) return operation();
    throw err;
  }
}

export function createAiUsageRepository(db: DbClient): AiUsageRepository {
  return {
    async reserveRequest(userId, day, limits) {
      const usage = await retryOnUniqueConflict(() =>
        db.aiUsage.upsert({
          where: { userId_day: { userId, day } },
          create: { userId, day },
          update: {},
        }),
      );
      if (usage.promptTokens + usage.completionTokens >= limits.tokens) {
        return { status: 'limit-reached', limit: 'tokens' };
      }
      const { count } = await db.aiUsage.updateMany({
        where: { id: usage.id, requestCount: { lt: limits.requests } },
        data: { requestCount: { increment: 1 } },
      });
      return count === 1 ? { status: 'reserved' } : { status: 'limit-reached', limit: 'requests' };
    },

    async addTokens(userId, day, { promptTokens, completionTokens }) {
      await retryOnUniqueConflict(() =>
        db.aiUsage.upsert({
          where: { userId_day: { userId, day } },
          create: { userId, day, promptTokens, completionTokens },
          update: {
            promptTokens: { increment: promptTokens },
            completionTokens: { increment: completionTokens },
          },
        }),
      );
    },

    find(userId, day) {
      return db.aiUsage.findUnique({ where: { userId_day: { userId, day } } });
    },
  };
}
