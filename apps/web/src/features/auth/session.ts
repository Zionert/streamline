import { refreshSession } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/**
 * Restores the session from the refresh cookie once per app start. The `idle` check (with the
 * status switched to `loading` synchronously) makes repeated calls no-ops, e.g. the second effect
 * run under React StrictMode: a second refresh would present an already rotated token.
 */
export async function restoreSession(): Promise<void> {
  const store = useAuthStore.getState();
  if (store.status !== 'idle') {
    return;
  }
  store.setLoading();
  try {
    await refreshSession();
  } catch {
    // No valid refresh cookie or the API is unreachable: continue as a guest.
    if (useAuthStore.getState().status !== 'authenticated') {
      useAuthStore.getState().clearSession();
    }
  }
}
