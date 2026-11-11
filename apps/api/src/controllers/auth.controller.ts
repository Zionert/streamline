import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type MeResponse,
} from '@streamline/shared';
import type { CookieOptions, Request, Response } from 'express';

import type { AppConfig } from '../config/env.js';
import { RefreshTokenRotatedError } from '../errors/app-error.js';
import { getAuthUserId } from '../middleware/require-auth.js';
import type { AuthService, AuthSession } from '../services/auth.service.js';

export const REFRESH_COOKIE_NAME = 'refresh_token';

export type AuthCookieConfig = Pick<
  AppConfig,
  'NODE_ENV' | 'REFRESH_COOKIE_PATH' | 'REFRESH_TOKEN_TTL_SECONDS'
>;

/**
 * Attributes of the refresh cookie. `SameSite=Strict` is possible because the SPA reaches the API
 * same-site (through the `/api` proxy); the cookie is never needed on cross-site navigation.
 * The path limits the cookie to the auth endpoints, so it is not sent with other API requests.
 */
export function refreshCookieOptions(config: AuthCookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: config.REFRESH_COOKIE_PATH,
  };
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function createAuthController(authService: AuthService, config: AuthCookieConfig) {
  const cookieOptions = refreshCookieOptions(config);

  function sendSession(res: Response<AuthResponse>, status: number, session: AuthSession): void {
    res
      .status(status)
      .set('Cache-Control', 'no-store')
      .cookie(REFRESH_COOKIE_NAME, session.refreshToken.token, {
        ...cookieOptions,
        maxAge: config.REFRESH_TOKEN_TTL_SECONDS * 1000,
      })
      .json({ accessToken: session.accessToken, user: session.user });
  }

  function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
  }

  return {
    register: async (req: Request, res: Response<AuthResponse>): Promise<void> => {
      const input = registerSchema.parse(req.body);
      sendSession(res, 201, await authService.register(input));
    },

    login: async (req: Request, res: Response<AuthResponse>): Promise<void> => {
      const input = loginSchema.parse(req.body);
      sendSession(res, 200, await authService.login(input));
    },

    refresh: async (req: Request, res: Response<AuthResponse>): Promise<void> => {
      try {
        sendSession(res, 200, await authService.refresh(readRefreshCookie(req)));
      } catch (err) {
        // A rejected refresh token is useless to the client; drop it. A token that lost a
        // concurrent rotation is the exception: the winning response has just set a new cookie,
        // which clearing would wipe out.
        if (!(err instanceof RefreshTokenRotatedError)) {
          clearRefreshCookie(res);
        }
        throw err;
      }
    },

    logout: async (req: Request, res: Response): Promise<void> => {
      await authService.logout(readRefreshCookie(req));
      clearRefreshCookie(res);
      res.status(204).end();
    },

    me: async (req: Request, res: Response<MeResponse>): Promise<void> => {
      const user = await authService.getCurrentUser(getAuthUserId(req));
      res.set('Cache-Control', 'no-store').json({ user });
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
