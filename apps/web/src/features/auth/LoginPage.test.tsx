import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith, testUser } from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

function renderLogin(state?: unknown) {
  useAuthStore.getState().clearSession();
  return renderApp({ pathname: '/login', state });
}

function fillIn(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('LoginPage', () => {
  it('shows field errors from the shared schema and sends nothing', async () => {
    renderLogin();

    fillIn('Email', 'not-an-email');
    submit();

    expect(await screen.findByText('Password is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(/invalid/i);
    expect(mock.current.requests).toHaveLength(0);
  });

  it('logs in, stores the session and opens the boards page', async () => {
    mock.current.on('POST', '/auth/login', { status: 200, data: sessionWith('token-1') });
    const { router } = renderLogin();

    fillIn('Email', '  Jan@Example.com ');
    fillIn('Password', 'secret-password');
    submit();

    expect(
      await screen.findByRole('button', { name: `Account menu for ${testUser.name}` }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/boards');
    expect(mock.current.requestsTo('POST', '/auth/login')[0]?.data).toEqual({
      email: 'jan@example.com',
      password: 'secret-password',
    });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'token-1',
      status: 'authenticated',
    });
  });

  it('returns to the originally requested location after login', async () => {
    mock.current.on('POST', '/auth/login', { status: 200, data: sessionWith('token-1') });
    const { router } = renderLogin({
      from: { pathname: '/boards', search: '?view=board', hash: '' },
    });

    fillIn('Email', 'jan@example.com');
    fillIn('Password', 'secret-password');
    submit();

    await waitFor(() => expect(router.state.location.search).toBe('?view=board'));
    expect(router.state.location.pathname).toBe('/boards');
  });

  it('shows the server error for invalid credentials', async () => {
    mock.current.on('POST', '/auth/login', {
      status: 401,
      data: errorBody('UNAUTHORIZED', 'Invalid email or password'),
    });
    renderLogin();

    fillIn('Email', 'jan@example.com');
    fillIn('Password', 'wrong-password');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(0);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('shows a generic message when the server is unreachable', async () => {
    mock.current.on('POST', '/auth/login', 'network-error');
    renderLogin();

    fillIn('Email', 'jan@example.com');
    fillIn('Password', 'secret-password');
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the server');
  });

  it('disables the submit button while the request is pending', async () => {
    const gate = deferred<MockReply>();
    mock.current.on('POST', '/auth/login', () => gate.promise);
    renderLogin();

    fillIn('Email', 'jan@example.com');
    fillIn('Password', 'secret-password');
    submit();

    expect(await screen.findByRole('button', { name: 'Logging in...' })).toBeDisabled();
    gate.resolve({ status: 200, data: sessionWith('token-1') });
    expect(
      await screen.findByRole('button', { name: `Account menu for ${testUser.name}` }),
    ).toBeInTheDocument();
  });

  it('links to the registration page', async () => {
    const { router } = renderLogin();

    fireEvent.click(screen.getByRole('link', { name: 'Create one' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/register'));
    expect(
      screen.getByRole('heading', { name: 'Create your StreamLine account' }),
    ).toBeInTheDocument();
  });
});
