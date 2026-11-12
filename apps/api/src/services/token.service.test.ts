import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { AccessTokenExpiredError, UnauthorizedError } from '../errors/app-error.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  createTokenService,
  hashRefreshToken,
} from './token.service.js';

const config = {
  JWT_ACCESS_SECRET: 'unit-test-secret-that-is-long-enough-012345',
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 604800,
};

describe('token service', () => {
  const tokens = createTokenService(config);

  it('signs an HS256 access token with sub and a 15 minute expiry', async () => {
    const token = await tokens.signAccessToken('user-1');
    const payload = decodeJwt(token);

    expect(decodeProtectedHeader(token).alg).toBe('HS256');
    expect(payload.sub).toBe('user-1');
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
  });

  it('verifies its own token and returns the user id', async () => {
    const token = await tokens.signAccessToken('user-1');

    await expect(tokens.verifyAccessToken(token)).resolves.toBe('user-1');
  });

  it('rejects a token signed with a different secret', async () => {
    const other = createTokenService({ ...config, JWT_ACCESS_SECRET: 'x'.repeat(40) });
    const token = await other.signAccessToken('user-1');

    await expect(tokens.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('returns the user id and the expiry of a valid token', async () => {
    const token = await tokens.signAccessToken('user-1');
    const { exp } = decodeJwt(token);

    await expect(tokens.verifyAccessTokenClaims(token)).resolves.toEqual({
      userId: 'user-1',
      expiresAt: (exp ?? 0) * 1000,
    });
  });

  it('sets the issuer and audience claims', async () => {
    const payload = decodeJwt(await tokens.signAccessToken('user-1'));

    expect(payload.iss).toBe(ACCESS_TOKEN_ISSUER);
    expect(payload.aud).toBe(ACCESS_TOKEN_AUDIENCE);
  });

  describe('claims of a correctly signed token', () => {
    const secret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
    const nowSeconds = Math.floor(Date.now() / 1000);

    function baseToken() {
      return new SignJWT().setProtectedHeader({ alg: 'HS256' }).setSubject('user-1');
    }

    it('rejects a token without iss and aud', async () => {
      const token = await baseToken().setExpirationTime('15m').sign(secret);

      await expect(tokens.verifyAccessToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('rejects a token with another issuer or audience', async () => {
      const otherIssuer = await baseToken()
        .setIssuer('someone-else')
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setExpirationTime('15m')
        .sign(secret);
      const otherAudience = await baseToken()
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience('another-service')
        .setExpirationTime('15m')
        .sign(secret);

      await expect(tokens.verifyAccessToken(otherIssuer)).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(tokens.verifyAccessToken(otherAudience)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('reports an expired token with AccessTokenExpiredError', async () => {
      const expired = await baseToken()
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setIssuedAt(nowSeconds - 3600)
        .setExpirationTime(nowSeconds - 60)
        .sign(secret);

      const error: unknown = await tokens.verifyAccessToken(expired).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(AccessTokenExpiredError);
      expect(error).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    });

    it('does not report an expired token signed with another secret as expired', async () => {
      const forged = await baseToken()
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setExpirationTime(nowSeconds - 60)
        .sign(new TextEncoder().encode('y'.repeat(40)));

      const error: unknown = await tokens.verifyAccessToken(forged).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error).not.toBeInstanceOf(AccessTokenExpiredError);
    });
  });

  it('rejects garbage', async () => {
    await expect(tokens.verifyAccessToken('garbage')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('issues random 256-bit refresh tokens with a matching SHA-256 hash and 7 day expiry', () => {
    const before = Date.now();
    const first = tokens.issueRefreshToken();
    const second = tokens.issueRefreshToken();

    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashRefreshToken(first.token));
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.expiresAt.getTime() - before).toBeGreaterThanOrEqual(604800 * 1000);
    expect(first.expiresAt.getTime() - before).toBeLessThan(604800 * 1000 + 5000);
  });
});
