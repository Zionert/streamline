import type { RefreshToken } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';

export type { RefreshToken };

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface RefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  /**
   * Atomically revokes the token `oldId` and stores its replacement.
   * Returns `null` (and stores nothing) when `oldId` was already revoked, e.g. by a concurrent
   * request presenting the same token.
   */
  rotate(oldId: string, replacement: CreateRefreshTokenData): Promise<RefreshToken | null>;
  /** Revokes a single token; a no-op when it is already revoked. */
  revokeByHash(tokenHash: string): Promise<void>;
  /** Revokes every still-active token of the user. */
  revokeAllForUser(userId: string): Promise<void>;
}

export function createRefreshTokenRepository(db: DbClient): RefreshTokenRepository {
  return {
    create(data) {
      return db.refreshToken.create({ data });
    },

    findByHash(tokenHash) {
      return db.refreshToken.findUnique({ where: { tokenHash } });
    },

    rotate(oldId, replacement) {
      return db.$transaction(async (tx) => {
        const now = new Date();
        const { count } = await tx.refreshToken.updateMany({
          where: { id: oldId, revokedAt: null },
          data: { revokedAt: now },
        });
        if (count === 0) {
          return null;
        }
        const created = await tx.refreshToken.create({ data: replacement });
        await tx.refreshToken.update({
          where: { id: oldId },
          data: { replacedById: created.id },
        });
        return created;
      });
    },

    async revokeByHash(tokenHash) {
      await db.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },

    async revokeAllForUser(userId) {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
}
