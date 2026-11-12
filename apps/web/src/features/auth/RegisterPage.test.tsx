import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith, testUser } from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

function renderRegister() {
  useAuthStore.getState().clearSession();
  return renderApp('/register');
}

function fillIn(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

function fillValidForm() {
  fillIn('Name', 'Jan');
  fillIn('Email', 'jan@example.com');
  fillIn('Password', 'secret-password');
}

describe('RegisterPage', () => {
  it('shows field errors from the shared schema and sends nothing', async () => {
    renderRegister();

    fillIn('Email', 'not-an-email');
    fillIn('Password', 'short');
    submit();

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters long')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.current.requests).toHaveLength(0);
  });

  it('creates the account, stores the session and opens the boards page', async () => {
    mock.current.on('POST', '/auth/register', { status: 201, data: sessionWith('token-1') });
    const { router } = renderRegister();

    fillIn('Name', ' Jan Kowalski ');
    fillIn('Email', 'Jan@example.com');
    fillIn('Password', 'secret-password');
    submit();

    expect(
      await screen.findByRole('button', { name: `Account menu for ${testUser.name}` }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/boards');
    expect(mock.current.requestsTo('POST', '/auth/register')[0]?.data).toEqual({
      name: 'Jan Kowalski',
      email: 'jan@example.com',
      password: 'secret-password',
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('shows the server error when the email is already taken', async () => {
    mock.current.on('POST', '/auth/register', {
      status: 409,
      data: errorBody('CONFLICT', 'An account with this email already exists'),
    });
    renderRegister();

    fillValidForm();
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists',
    );
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('shows a rate limit message on 429', async () => {
    mock.current.on('POST', '/auth/register', {
      status: 429,
      data: errorBody('TOO_MANY_REQUESTS', 'Too many requests'),
    });
    renderRegister();

    fillValidForm();
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('links to the login page', async () => {
    const { router } = renderRegister();

    fireEvent.click(screen.getByRole('link', { name: 'Log in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
