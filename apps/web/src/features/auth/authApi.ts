import {
  authResponseSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@streamline/shared';

import { api, waitForPendingRefresh } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/** Logs in and stores the session. */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const response = await api.post<unknown>('/auth/login', input);
  const session = authResponseSchema.parse(response.data);
  useAuthStore.getState().setSession(session);
  return session;
}

/** Creates an account and stores the session (the API logs the new user in). */
export async function register(input: RegisterInput): Promise<AuthResponse> {
  const response = await api.post<unknown>('/auth/register', input);
  const session = authResponseSchema.parse(response.data);
  useAuthStore.getState().setSession(session);
  return session;
}

/**
 * Revokes the refresh token on the server. The local session is cleared even if the request
 * fails, so the user is never stuck logged in; the function therefore never rejects.
 * A refresh in flight is awaited first: it rotates the cookie, and logout must revoke the newest one.
 */
export async function logout(): Promise<void> {
  try {
    await waitForPendingRefresh();
    await api.post('/auth/logout');
  } catch {
    // Ignored on purpose: the local session is cleared below either way.
  } finally {
    useAuthStore.getState().clearSession();
  }
}
