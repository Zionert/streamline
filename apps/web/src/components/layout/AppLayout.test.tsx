import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith, testUser } from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

function renderLoggedIn() {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  return renderApp('/');
}

describe('AppLayout', () => {
  it('shows the current user', () => {
    renderLoggedIn();

    expect(screen.getByText(testUser.name)).toBeInTheDocument();
    expect(screen.getByText(`(${testUser.email})`)).toBeInTheDocument();
  });

  it('logs out, clears the session and opens the login page', async () => {
    mock.current.on('POST', '/auth/logout', { status: 204 });
    const { router } = renderLoggedIn();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(router.state.location.pathname).toBe('/login');
    expect(mock.current.requestsTo('POST', '/auth/logout')).toHaveLength(1);
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
    });
  });

  it('clears the session even when the logout request fails', async () => {
    mock.current.on('POST', '/auth/logout', { status: 500, data: errorBody('INTERNAL_ERROR') });
    const { router } = renderLoggedIn();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(0);
  });
});
