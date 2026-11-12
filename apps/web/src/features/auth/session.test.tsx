import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith, testUser } from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

import { restoreSession } from './session';

const mock = setupMockApi();

describe('restoreSession', () => {
  it('restores the session from the refresh cookie', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-1') });

    await restoreSession();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'token-1',
      user: testUser,
      status: 'authenticated',
    });
  });

  it('refreshes only once when called repeatedly', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-1') });

    await Promise.all([restoreSession(), restoreSession()]);
    await restoreSession();

    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('continues as a guest when there is no valid refresh cookie', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 401, data: errorBody('UNAUTHORIZED') });

    await restoreSession();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('continues as a guest when the API is unreachable', async () => {
    mock.current.on('POST', '/auth/refresh', 'network-error');

    await restoreSession();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});

describe('session restore on app start', () => {
  it('refreshes exactly once under StrictMode and shows the protected page', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 200, data: sessionWith('token-1') });

    renderApp('/', { strict: true });

    expect(screen.getByRole('status')).toHaveTextContent('Restoring session...');
    expect(
      await screen.findByRole('button', { name: `Account menu for ${testUser.name}` }),
    ).toBeInTheDocument();
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('redirects to the login page when the session cannot be restored', async () => {
    mock.current.on('POST', '/auth/refresh', { status: 401, data: errorBody('UNAUTHORIZED') });

    const { router } = renderApp('/', { strict: true });

    expect(
      await screen.findByRole('heading', { name: 'Log in to StreamLine' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
  });
});
