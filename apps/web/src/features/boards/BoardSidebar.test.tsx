import type { BoardRole } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOBILE_SCREEN_QUERY, NARROW_SCREEN_QUERY } from '@/hooks/useMediaQuery';
import { useAuthStore } from '@/stores/auth';
import { boardWith, defaultColumns, memberWith, sessionWith } from '@/test/fixtures';
import { setMediaQuery } from '@/test/matchMedia';
import { renderApp, setupMockApi } from '@/test/renderApp';

import { BOARD_SIDEBAR_ID } from './BoardSidebar';
import { SIDEBAR_STORAGE_KEY } from './sidebarState';

const mock = setupMockApi();

const BOARD = '/boards/board-1';

async function renderBoard(role: BoardRole = 'OWNER') {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role })] },
  });
  const result = renderApp(BOARD);
  await screen.findByRole('heading', { level: 1, name: 'Board' });
  return result;
}

/** The docked sidebar; looked up by id because a collapsed sidebar is hidden from queries. */
function sidebar(): HTMLElement {
  const element = document.getElementById(BOARD_SIDEBAR_ID);
  if (!element) {
    throw new Error('No sidebar');
  }
  expect(element).toHaveAttribute('aria-label', 'Board navigation');
  return element;
}

/** Radix registers its outside-click listener one tick after the drawer opens. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('BoardSidebar: docked', () => {
  it('shows the board and its navigation, with Board as the active item', async () => {
    await renderBoard('OWNER');

    const nav = within(sidebar()).getByRole('navigation', { name: 'Board' });
    expect(within(sidebar()).getByText('Sprint board')).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Board' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: /Analytics/ })).toBeDisabled();
    expect(within(nav).getByRole('button', { name: /Analytics/ })).toHaveTextContent('Soon');
    expect(within(nav).getByRole('button', { name: /Settings/ })).toBeDisabled();
  });

  it('hides Settings from members without the permission', async () => {
    await renderBoard('MEMBER');

    const nav = within(sidebar()).getByRole('navigation', { name: 'Board' });
    expect(within(nav).queryByRole('button', { name: /Settings/ })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Members' })).toBeEnabled();
  });

  it('opens the members dialog', async () => {
    await renderBoard('OWNER');

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Members' }));

    expect(await screen.findByRole('dialog', { name: 'Members' })).toBeVisible();
  });

  it('collapses and remembers the choice', async () => {
    const { unmount } = await renderBoard();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', sidebar().id);

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(sidebar()).toHaveAttribute('aria-hidden', 'true');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');

    unmount();
    await renderBoard();

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar()).not.toHaveAttribute('aria-hidden');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
  });

  it('starts collapsed below 1024 px unless the user expanded it before', async () => {
    setMediaQuery(NARROW_SCREEN_QUERY, true);
    const { unmount } = await renderBoard();

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    unmount();

    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false');
    await renderBoard();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('keeps working when storage is unavailable', async () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });
});

describe('BoardSidebar: mobile drawer', () => {
  it('is closed by default and opens from the board header', async () => {
    setMediaQuery(MOBILE_SCREEN_QUERY, true);
    await renderBoard();

    expect(screen.queryByRole('dialog', { name: 'Board navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
    const open = screen.getByRole('button', { name: 'Open board navigation' });
    expect(open).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(open);

    const drawer = await screen.findByRole('dialog', { name: 'Board navigation' });
    expect(within(drawer).getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(open).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes on Escape and on a click on the backdrop', async () => {
    setMediaQuery(MOBILE_SCREEN_QUERY, true);
    await renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Open board navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Board navigation' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open board navigation' }));
    await screen.findByRole('dialog', { name: 'Board navigation' });
    await flush();
    const backdrop = screen.getByTestId('sidebar-backdrop');
    // A mouse click: Radix dismisses on the click that follows the primary-button pointerdown.
    fireEvent.pointerDown(backdrop, { button: 0 });
    fireEvent.click(backdrop, { button: 0 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes and opens the members dialog from the drawer', async () => {
    setMediaQuery(MOBILE_SCREEN_QUERY, true);
    await renderBoard();

    fireEvent.click(screen.getByRole('button', { name: 'Open board navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Board navigation' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Members' }));

    expect(await screen.findByRole('dialog', { name: 'Members' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Board navigation' })).toBeNull();
  });

  it('does not reopen the drawer by itself after a resize', async () => {
    setMediaQuery(MOBILE_SCREEN_QUERY, true);
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Open board navigation' }));
    await screen.findByRole('dialog', { name: 'Board navigation' });

    act(() => setMediaQuery(MOBILE_SCREEN_QUERY, false));
    expect(await screen.findByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    act(() => setMediaQuery(MOBILE_SCREEN_QUERY, true));

    expect(await screen.findByRole('button', { name: 'Open board navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('dialog', { name: 'Board navigation' })).toBeNull();
  });

  it('switches to the drawer when the screen becomes narrow', async () => {
    await renderBoard();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();

    setMediaQuery(MOBILE_SCREEN_QUERY, true);

    expect(await screen.findByRole('button', { name: 'Open board navigation' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull();
  });
});
