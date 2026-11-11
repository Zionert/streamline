import type { LoginInput, PublicUser, RegisterInput } from '@streamline/shared';
import type { Logger } from 'pino';

import { ConflictError, RefreshTokenRotatedError, UnauthorizedError } from '../errors/app-error.js';
import type {
  RefreshToken,
  RefreshTokenRepository,
} from '../repositories/refresh-token.repository.js';
import type { User, UserRepository } from '../repositories/user.repository.js';
import type { PasswordHasher } from './password.service.js';
import type { TokenService } from './token.service.js';

export interface AuthSession {
  accessToken: string;
  refreshToken: { token: string; expiresAt: Date };
  user: PublicUser;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  /** Exchanges a refresh token for a new session, rotating the refresh token. */
  refresh(refreshToken: string | undefined): Promise<AuthSession>;
  /** Revokes the refresh token if it is known; never fails for unknown or missing tokens. */
  logout(refreshToken: string | undefined): Promise<void>;
  getCurrentUser(userId: string): Promise<PublicUser>;
}

export interface AuthServiceDependencies {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  passwords: PasswordHasher;
  tokens: TokenService;
  logger: Logger;
  /** See `REFRESH_REUSE_GRACE_SECONDS`. */
  refreshReuseGraceSeconds: number;
}

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH_TOKEN = 'Invalid or expired refresh token';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export function createAuthService({
  users,
  refreshTokens,
  passwords,
  tokens,
  logger,
  refreshReuseGraceSeconds,
}: AuthServiceDependencies): AuthService {
  async function startSession(user: User): Promise<AuthSession> {
    const refreshToken = tokens.issueRefreshToken();
    await refreshTokens.create({
      userId: user.id,
      tokenHash: refreshToken.tokenHash,
      expiresAt: refreshToken.expiresAt,
    });
    return {
      accessToken: await tokens.signAccessToken(user.id),
      refreshToken: { token: refreshToken.token, expiresAt: refreshToken.expiresAt },
      user: toPublicUser(user),
    };
  }

  /** True when the token was replaced by rotation recently enough to be a concurrent refresh. */
  function isRecentlyRotated(token: RefreshToken): boolean {
    return (
      token.replacedById !== null &&
      token.revokedAt !== null &&
      Date.now() - token.revokedAt.getTime() < refreshReuseGraceSeconds * 1000
    );
  }

  async function handleTokenReuse(userId: string): Promise<never> {
    await refreshTokens.revokeAllForUser(userId);
    logger.warn({ userId }, 'Refresh token reuse detected; all sessions of the user revoked');
    throw new UnauthorizedError(INVALID_REFRESH_TOKEN);
  }

  return {
    async register({ email, password, name }) {
      const passwordHash = await passwords.hash(password);
      const user = await users.create({ email, passwordHash, name });
      if (!user) {
        throw new ConflictError('An account with this email already exists');
      }
      return startSession(user);
    },

    async login({ email, password }) {
      const user = await users.findByEmail(email);
      const valid = user
        ? await passwords.verify(password, user.passwordHash)
        : await passwords.verifyDummy(password);
      if (!user || !valid) {
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }
      return startSession(user);
    },

    async refresh(rawToken) {
      if (!rawToken) {
        throw new UnauthorizedError('Refresh token is missing');
      }

      const stored = await refreshTokens.findByHash(tokens.hashRefreshToken(rawToken));
      if (!stored) {
        throw new UnauthorizedError(INVALID_REFRESH_TOKEN);
      }
      if (stored.revokedAt) {
        if (isRecentlyRotated(stored)) {
          throw new RefreshTokenRotatedError();
        }
        return handleTokenReuse(stored.userId);
      }
      if (stored.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedError(INVALID_REFRESH_TOKEN);
      }

      const user = await users.findById(stored.userId);
      if (!user) {
        throw new UnauthorizedError(INVALID_REFRESH_TOKEN);
      }

      const next = tokens.issueRefreshToken();
      const rotated = await refreshTokens.rotate(stored.id, {
        userId: user.id,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
      });
      if (!rotated) {
        // A concurrent request with the same token won the rotation a moment ago.
        throw new RefreshTokenRotatedError();
      }

      return {
        accessToken: await tokens.signAccessToken(user.id),
        refreshToken: { token: next.token, expiresAt: next.expiresAt },
        user: toPublicUser(user),
      };
    },

    async logout(rawToken) {
      if (rawToken) {
        await refreshTokens.revokeByHash(tokens.hashRefreshToken(rawToken));
      }
    },

    async getCurrentUser(userId) {
      const user = await users.findById(userId);
      if (!user) {
        throw new UnauthorizedError();
      }
      return toPublicUser(user);
    },
  };
}
