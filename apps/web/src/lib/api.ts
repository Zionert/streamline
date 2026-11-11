import { authResponseSchema, errorResponseSchema, type AuthResponse } from '@streamline/shared';
import axios, { type AxiosAdapter, type AxiosInstance, isAxiosError } from 'axios';
import { ZodError } from 'zod';

import { useAuthStore } from '@/stores/auth';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Do not try to refresh the session when this request fails with 401. */
    skipAuthRefresh?: boolean;
    /** Set on a request that is being replayed after a session refresh (replayed at most once). */
    authRetried?: boolean;
    /** Access token attached to the request by the request interceptor. */
    sentAccessToken?: string | null;
  }
}

export const REFRESH_TOKEN_ROTATED = 'REFRESH_TOKEN_ROTATED';

/** Default pause before retrying `/auth/refresh` after `REFRESH_TOKEN_ROTATED`. */
export const DEFAULT_ROTATED_RETRY_DELAY_MS = 400;

/**
 * Auth endpoints never trigger a refresh themselves: a failed login/register is a user error,
 * a failed refresh/logout must not recurse into another refresh.
 */
const AUTH_ENDPOINT_PATTERN = /(?:^|\/)auth\/(?:refresh|login|register|logout)\/?(?:[?#]|$)/;

export function isAuthEndpoint(url: string | undefined): boolean {
  return url !== undefined && AUTH_ENDPOINT_PATTERN.test(url);
}

function getErrorCode(error: unknown): string | undefined {
  if (!isAxiosError(error)) {
    return undefined;
  }
  const parsed = errorResponseSchema.safeParse(error.response?.data);
  return parsed.success ? parsed.data.error.code : undefined;
}

function isUnauthorized(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401;
}

function isRefreshTokenRotated(error: unknown): boolean {
  return isUnauthorized(error) && getErrorCode(error) === REFRESH_TOKEN_ROTATED;
}

/** A refresh failure that proves the session is gone (as opposed to a network or server hiccup). */
function endsSession(error: unknown): boolean {
  return isUnauthorized(error) || error instanceof ZodError;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface ApiClientOptions {
  /** Pause before the single retry of `/auth/refresh` after `REFRESH_TOKEN_ROTATED`. */
  rotatedRetryDelayMs?: number;
  /** Injectable timer, so tests do not have to wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Custom transport (used by tests). */
  adapter?: AxiosAdapter;
}

export interface ApiClient {
  api: AxiosInstance;
  /**
   * Exchanges the refresh cookie for a new session and stores it. Concurrent callers share one
   * request (single flight), because every refresh rotates the token and a parallel second call
   * would present an already rotated cookie. Clears the session when the server rejects the token.
   */
  refreshSession: () => Promise<AuthResponse>;
  /** Resolves once the refresh in flight (if any) has settled; never rejects. */
  waitForPendingRefresh: () => Promise<void>;
}

/** Thrown when the session was cleared (e.g. logout) while a refresh was in flight. */
export class StaleRefreshError extends Error {
  constructor() {
    super('The session ended while it was being refreshed');
    this.name = 'StaleRefreshError';
  }
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const rotatedRetryDelayMs = options.rotatedRetryDelayMs ?? DEFAULT_ROTATED_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
    ...(options.adapter ? { adapter: options.adapter } : {}),
  });

  let refreshInFlight: Promise<AuthResponse> | null = null;

  async function requestRefresh(): Promise<AuthResponse> {
    const response = await api.post<unknown>('/auth/refresh', undefined, {
      skipAuthRefresh: true,
    });
    return authResponseSchema.parse(response.data);
  }

  async function performRefresh(): Promise<AuthResponse> {
    const epoch = useAuthStore.getState().sessionEpoch;
    const isCurrent = () => useAuthStore.getState().sessionEpoch === epoch;
    try {
      let session: AuthResponse;
      try {
        session = await requestRefresh();
      } catch (error) {
        if (!isRefreshTokenRotated(error)) {
          throw error;
        }
        // Another request (e.g. a second tab) has just rotated the cookie; the browser should
        // receive the new one shortly, so wait and try exactly once more.
        await sleep(rotatedRetryDelayMs);
        session = await requestRefresh();
      }
      if (!isCurrent()) {
        throw new StaleRefreshError();
      }
      useAuthStore.getState().setSession(session);
      return session;
    } catch (error) {
      if (endsSession(error) && isCurrent()) {
        useAuthStore.getState().clearSession();
      }
      throw error;
    }
  }

  function refreshSession(): Promise<AuthResponse> {
    refreshInFlight ??= performRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function waitForPendingRefresh(): Promise<void> {
    if (!refreshInFlight) {
      return Promise.resolve();
    }
    return refreshInFlight.then(
      () => undefined,
      () => undefined,
    );
  }

  api.interceptors.request.use((config) => {
    const { accessToken } = useAuthStore.getState();
    config.sentAccessToken = accessToken;
    if (accessToken) {
      config.headers.set('Authorization', `Bearer ${accessToken}`);
    }
    return config;
  });

  api.interceptors.response.use(undefined, async (error: unknown) => {
    if (!isUnauthorized(error) || !isAxiosError(error) || !error.config) {
      throw error;
    }
    const config = error.config;
    if (config.skipAuthRefresh || config.authRetried || isAuthEndpoint(config.url)) {
      throw error;
    }
    config.authRetried = true;

    // If another request has already refreshed the session since this one was sent,
    // replay it with the current token instead of rotating again.
    const { accessToken } = useAuthStore.getState();
    if (!accessToken || accessToken === config.sentAccessToken) {
      try {
        await refreshSession();
      } catch {
        throw error;
      }
    }
    return api.request(config);
  });

  return { api, refreshSession, waitForPendingRefresh };
}

export const { api, refreshSession, waitForPendingRefresh } = createApiClient();
