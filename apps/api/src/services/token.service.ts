import { createHash, randomBytes } from 'node:crypto';

import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';

import type { AppConfig } from '../config/env.js';
import { AccessTokenExpiredError, UnauthorizedError } from '../errors/app-error.js';

const ACCESS_TOKEN_ALGORITHM = 'HS256';
/** `iss` of access tokens: only tokens issued by this API are accepted. */
export const ACCESS_TOKEN_ISSUER = 'streamline-api';
/** `aud` of access tokens: they authorize calls to this API (REST and Socket.io). */
export const ACCESS_TOKEN_AUDIENCE = 'streamline-api';
const REFRESH_TOKEN_BYTES = 32;

export interface IssuedRefreshToken {
  /** Opaque value sent to the client; never stored. */
  token: string;
  /** SHA-256 hash of the token; the only form stored in the database. */
  tokenHash: string;
  expiresAt: Date;
}

/** Claims of a verified access token. */
export interface VerifiedAccessToken {
  userId: string;
  /** End of the token's validity (`exp`), in milliseconds since the epoch. */
  expiresAt: number;
}

export interface TokenService {
  signAccessToken(userId: string): Promise<string>;
  /**
   * Returns the user id (`sub`) of a valid access token; throws `UnauthorizedError` otherwise
   * (`AccessTokenExpiredError`, a subclass, when the token is valid but expired).
   */
  verifyAccessToken(token: string): Promise<string>;
  /** Like `verifyAccessToken`, but also returns when the token expires. */
  verifyAccessTokenClaims(token: string): Promise<VerifiedAccessToken>;
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

  async function verifyAccessTokenClaims(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        requiredClaims: ['sub', 'exp', 'iss', 'aud'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new UnauthorizedError('Invalid access token');
      }
      if (typeof payload.exp !== 'number') {
        throw new UnauthorizedError('Invalid access token');
      }
      return { userId: payload.sub, expiresAt: payload.exp * 1000 };
    } catch (err) {
      // jose checks the signature before the claims, so an expired token is otherwise valid.
      if (err instanceof joseErrors.JWTExpired) {
        throw new AccessTokenExpiredError();
      }
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  return {
    signAccessToken(userId) {
      return new SignJWT()
        .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(secret);
    },

    async verifyAccessToken(token) {
      return (await verifyAccessTokenClaims(token)).userId;
    },

    verifyAccessTokenClaims,

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
