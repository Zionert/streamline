import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { THEME_STORAGE_KEY } from '@/lib/theme';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { sessionWith, testUser } from '@/test/fixtures';
import { chooseMenuItem, openMenu } from '@/test/menu';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const ACCOUNT_MENU = `Account menu for ${testUser.name}`;

function renderLoggedIn() {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  return renderApp('/');
}

describe('AppHeader', () => {
  it('links the logo to the board list', async () => {
    const { router } = renderLoggedIn();
    await screen.findByRole('heading', { name: 'Your boards' });

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'StreamLine, your boards' })).toHaveAttribute(
      'href',
      '/boards',
    );
    expect(router.state.location.pathname).toBe('/boards');
  });

  it('shows the current user in the account menu', async () => {
    renderLoggedIn();

    const menu = await openMenu(ACCOUNT_MENU);

    expect(within(menu).getByText(testUser.name)).toBeInTheDocument();
    expect(within(menu).getByText(testUser.email)).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('logs out from the account menu, clears the session and opens the login page', async () => {
    mock.current.on('POST', '/auth/logout', { status: 204 });
    const { router } = renderLoggedIn();

    await chooseMenuItem(ACCOUNT_MENU, 'Log out');

    expect(
      await screen.findByRole('heading', { name: 'Log in to StreamLine' }),
    ).toBeInTheDocument();
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

    await chooseMenuItem(ACCOUNT_MENU, 'Log out');

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(mock.current.requestsTo('POST', '/auth/refresh')).toHaveLength(0);
  });

  it('switches the theme from the theme menu and remembers the choice', async () => {
    renderLoggedIn();

    let menu = await openMenu('Theme');
    expect(within(menu).getByRole('menuitemradio', { name: 'Light' })).toBeChecked();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(useThemeStore.getState().preference).toBe('dark');

    menu = await openMenu('Theme');
    expect(within(menu).getByRole('menuitemradio', { name: 'Dark' })).toBeChecked();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Light' }));

    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
