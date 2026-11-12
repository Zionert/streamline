import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation, type InitialEntry } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetAuthStore, useAuthStore } from '@/stores/auth';
import { sessionWith } from '@/test/fixtures';

import { GuestRoute } from './GuestRoute';
import { ProtectedRoute } from './ProtectedRoute';

function LoginProbe() {
  const location = useLocation();
  return <p>Login page, state: {JSON.stringify(location.state)}</p>;
}

function renderGuarded(initialEntry: InitialEntry) {
  const router = createMemoryRouter(
    [
      { element: <GuestRoute />, children: [{ path: '/login', element: <LoginProbe /> }] },
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/boards', element: <p>Home page</p> },
          { path: '/boards/:id', element: <p>Board page</p> },
        ],
      },
      {
        path: '/settings',
        element: (
          <ProtectedRoute>
            <p>Settings page</p>
          </ProtectedRoute>
        ),
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  resetAuthStore();
});

describe('ProtectedRoute', () => {
  it.each(['idle', 'loading'] as const)('shows a loading state while status is %s', (status) => {
    useAuthStore.setState({ status });

    renderGuarded('/boards/1');

    expect(screen.getByRole('status')).toHaveTextContent('Restoring session...');
    expect(screen.queryByText('Board page')).not.toBeInTheDocument();
  });

  it('redirects a guest to /login and remembers the requested location', () => {
    useAuthStore.getState().clearSession();

    const router = renderGuarded('/boards/1?tab=cards#c1');

    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByText(/Login page/)).toHaveTextContent(
      '{"from":{"pathname":"/boards/1","search":"?tab=cards","hash":"#c1"}}',
    );
  });

  it('renders nested routes for an authenticated user', () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));

    renderGuarded('/boards/1');

    expect(screen.getByText('Board page')).toBeInTheDocument();
  });

  it('renders children for an authenticated user', () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));

    renderGuarded('/settings');

    expect(screen.getByText('Settings page')).toBeInTheDocument();
  });
});

describe('GuestRoute', () => {
  it('shows a loading state while the session is being restored', () => {
    useAuthStore.setState({ status: 'loading' });

    renderGuarded('/login');

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the page for a guest', () => {
    useAuthStore.getState().clearSession();

    renderGuarded('/login');

    expect(screen.getByText(/Login page/)).toBeInTheDocument();
  });

  it('sends a logged-in user to the boards page', () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));

    const router = renderGuarded('/login');

    expect(router.state.location.pathname).toBe('/boards');
    expect(screen.getByText('Home page')).toBeInTheDocument();
  });

  it('sends a logged-in user to the remembered location', () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));

    const router = renderGuarded({
      pathname: '/login',
      state: { from: { pathname: '/boards/7' } },
    });

    expect(router.state.location.pathname).toBe('/boards/7');
  });
});
