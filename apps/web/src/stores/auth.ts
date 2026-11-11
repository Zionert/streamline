import type { AuthResponse, PublicUser } from '@streamline/shared';
import { create } from 'zustand';

/**
 * - `idle` — the session has not been checked yet (app just started),
 * - `loading` — the session is being restored from the refresh cookie,
 * - `authenticated` / `unauthenticated` — final states.
 */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  user: PublicUser | null;
  /** Kept only in memory on purpose: never persisted to web storage or JS-readable cookies. */
  accessToken: string | null;
  status: AuthStatus;
  /**
   * Incremented whenever the session is cleared. A refresh started before a logout compares it
   * to drop its (stale) result instead of logging the user back in.
   */
  sessionEpoch: number;
  setSession: (session: AuthResponse) => void;
  clearSession: () => void;
  setLoading: () => void;
}

const initialState: Pick<AuthState, 'user' | 'accessToken' | 'status' | 'sessionEpoch'> = {
  user: null,
  accessToken: null,
  status: 'idle',
  sessionEpoch: 0,
};

export const useAuthStore = create<AuthState>()((set) => ({
  ...initialState,
  setSession: ({ accessToken, user }) => set({ accessToken, user, status: 'authenticated' }),
  clearSession: () =>
    set((state) => ({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
      sessionEpoch: state.sessionEpoch + 1,
    })),
  setLoading: () => set({ status: 'loading' }),
}));

/** Restores the initial (`idle`) state; intended for tests. */
export function resetAuthStore(): void {
  useAuthStore.setState(initialState);
}
