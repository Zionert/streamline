import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { AppConfig } from '../config/env.js';
import { UnauthorizedError } from '../errors/app-error.js';

const ACCESS_TOKEN_ALGORITHM = 'HS256';
const REFRESH_TOKEN_BYTES = 32;

export interface IssuedRefreshToken {
  /** Opaque value sent to the client; never stored. */
  token: string;
  /** SHA-256 hash of the token; the only form stored in the database. */
  tokenHash: string;
  expiresAt: Date;
}

export interface TokenService {
  signAccessToken(userId: string): Promise<string>;
  /** Returns the user id (`sub`) of a valid access token; throws `UnauthorizedError` otherwise. */
  verifyAccessToken(token: string): Promise<string>;
  issueRefreshToken(): IssuedRefreshToken;
  hashRefreshToken(token: string): string;
}

export type TokenConfig = Pick<
  AppConfig,
  'JWT_ACCESS_SECRET' | 'ACCESS_TOKEN_TTL_SECONDS' | 'REFRESH_TOKEN_TTL_SECONDS'
>;

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createTokenService(config: TokenConfig): TokenService {
  const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

  return {
    signAccessToken(userId) {
      return new SignJWT()
        .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, typ: 'JWT' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(secret);
    },

    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, secret, {
          algorithms: [ACCESS_TOKEN_ALGORITHM],
          requiredClaims: ['sub', 'exp'],
        });
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
          throw new UnauthorizedError('Invalid access token');
        }
        return payload.sub;
      } catch {
        throw new UnauthorizedError('Invalid or expired access token');
      }
    },

    issueRefreshToken() {
      const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
      return {
        token,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000),
      };
    },

    hashRefreshToken,
  };
}
