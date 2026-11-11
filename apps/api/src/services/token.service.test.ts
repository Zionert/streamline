import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../errors/app-error.js';
import { createTokenService, hashRefreshToken } from './token.service.js';

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
