import { describe, expect, it, vi } from 'vitest';

import { refreshSession } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { sessionWith } from '@/test/fixtures';
import { deferred, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { logout } from './authApi';

const mock = setupMockApi();

describe('logout', () => {
  it('waits for a refresh in flight and stays logged out after it resolves', async () => {
    useAuthStore.getState().setSession(sessionWith('old'));
    const refreshGate = deferred<MockReply>();
    mock.current.on('POST', '/auth/refresh', () => refreshGate.promise);
    mock.current.on('POST', '/auth/logout', { status: 204 });

    const refresh = refreshSession();
    await vi.waitFor(() =>
      expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(1),
    );
    const loggingOut = logout();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The logout request must carry the cookie rotated by the pending refresh.
    expect(mock.current.requestsTo('POST', '/auth/logout')).toHaveLength(0);

    refreshGate.resolve({ status: 200, data: sessionWith('new') });
    await refresh;
    await loggingOut;

    expect(mock.current.requests.map((r) => r.url)).toEqual(['/auth/refresh', '/auth/logout']);
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
    });
  });

  it('logs out even when the pending refresh fails', async () => {
    useAuthStore.getState().setSession(sessionWith('old'));
    const refreshGate = deferred<MockReply>();
    mock.current.on('POST', '/auth/refresh', () => refreshGate.promise);
    mock.current.on('POST', '/auth/logout', { status: 204 });

    const refresh = refreshSession().catch(() => undefined);
    const loggingOut = logout();
    refreshGate.resolve({ status: 503, data: {} });
    await refresh;
    await loggingOut;

    expect(mock.current.requestsTo('POST', '/auth/logout')).toHaveLength(1);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
