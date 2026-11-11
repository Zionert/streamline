import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { RefreshTokenRotatedError, UnauthorizedError } from '../errors/app-error.js';
import type {
  RefreshToken,
  RefreshTokenRepository,
} from '../repositories/refresh-token.repository.js';
import type { User, UserRepository } from '../repositories/user.repository.js';
import { createAuthService } from './auth.service.js';
import type { PasswordHasher } from './password.service.js';
import { createTokenService } from './token.service.js';

const user: User = {
  id: 'user-1',
  email: 'jane@example.com',
  passwordHash: 'hash',
  name: 'Jane',
  createdAt: new Date('2026-11-11T10:00:00.000Z'),
  updatedAt: new Date('2026-11-11T10:00:00.000Z'),
};

const tokens = createTokenService({
  JWT_ACCESS_SECRET: 'unit-test-secret-that-is-long-enough-012345',
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 604800,
});

function storedToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: 'rt-1',
    userId: user.id,
    tokenHash: tokens.hashRefreshToken('raw'),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedById: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const mocks = {
    revokeAllForUser: vi.fn((_userId: string) => Promise.resolve()),
    revokeByHash: vi.fn((_tokenHash: string) => Promise.resolve()),
    findByHash: vi.fn((_tokenHash: string) => Promise.resolve<RefreshToken | null>(storedToken())),
    rotate: vi.fn(() => Promise.resolve<RefreshToken | null>(storedToken({ id: 'rt-2' }))),
    verifyDummy: vi.fn((_password: string) => Promise.resolve(false as const)),
  };
  const users: UserRepository = {
    findById: () => Promise.resolve(user),
    findByEmail: () => Promise.resolve(null),
    create: () => Promise.resolve(user),
  };
  const refreshTokens: RefreshTokenRepository = {
    create: () => Promise.resolve(storedToken()),
    findByHash: mocks.findByHash,
    rotate: mocks.rotate,
    revokeByHash: mocks.revokeByHash,
    revokeAllForUser: mocks.revokeAllForUser,
  };
  const passwords: PasswordHasher = {
    hash: () => Promise.resolve('hash'),
    verify: () => Promise.resolve(true),
    verifyDummy: mocks.verifyDummy,
  };
  const service = createAuthService({
    users,
    refreshTokens,
    passwords,
    tokens,
    logger: pino({ level: 'silent' }),
    refreshReuseGraceSeconds: 30,
  });
  return { service, mocks };
}

describe('auth service', () => {
  it('still runs a bcrypt comparison when the email is unknown', async () => {
    const { service, mocks } = setup();

    await expect(
      service.login({ email: 'ghost@example.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mocks.verifyDummy).toHaveBeenCalledWith('whatever');
  });

  it('reports a lost concurrent rotation without revoking other sessions', async () => {
    const { service, mocks } = setup();
    mocks.rotate.mockResolvedValueOnce(null);

    await expect(service.refresh('raw')).rejects.toBeInstanceOf(RefreshTokenRotatedError);
    expect(mocks.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('treats a token rotated within the grace window as a concurrent refresh', async () => {
    const { service, mocks } = setup();
    mocks.findByHash.mockResolvedValueOnce(
      storedToken({ revokedAt: new Date(Date.now() - 5_000), replacedById: 'rt-2' }),
    );

    await expect(service.refresh('raw')).rejects.toBeInstanceOf(RefreshTokenRotatedError);
    expect(mocks.revokeAllForUser).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it('revokes all user sessions when a token rotated before the grace window is reused', async () => {
    const { service, mocks } = setup();
    mocks.findByHash.mockResolvedValueOnce(
      storedToken({ revokedAt: new Date(Date.now() - 31_000), replacedById: 'rt-2' }),
    );

    const error = await service.refresh('raw').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).not.toBeInstanceOf(RefreshTokenRotatedError);
    expect(mocks.revokeAllForUser).toHaveBeenCalledWith(user.id);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it('revokes all user sessions when a token revoked without rotation is reused', async () => {
    const { service, mocks } = setup();
    // Revoked by logout or by an earlier mass revocation: no replacement, even if recent.
    mocks.findByHash.mockResolvedValueOnce(storedToken({ revokedAt: new Date() }));

    await expect(service.refresh('raw')).rejects.not.toBeInstanceOf(RefreshTokenRotatedError);
    expect(mocks.revokeAllForUser).toHaveBeenCalledWith(user.id);
  });

  it('does not touch the database on logout without a token', async () => {
    const { service, mocks } = setup();

    await service.logout(undefined);

    expect(mocks.revokeByHash).not.toHaveBeenCalled();
  });
});
