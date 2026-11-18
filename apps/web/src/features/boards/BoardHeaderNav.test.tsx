import type { BoardRole } from '@streamline/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { analyticsWith, countForecast } from '@/test/flowFixtures';
import { closeMenu, menuItemNames, openMenu, chooseMenuItem } from '@/test/menu';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;

const ola = memberWith({
  userId: 'user-ola',
  name: 'Ola Nowak',
  email: 'ola@example.com',
  role: 'MEMBER',
});

const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd', title: 'Fix login' });

async function renderBoard(role: BoardRole = 'OWNER', path = BOARD) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role }), ola] },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), [t1]) });
  mock.current.on('GET', `${BOARD}/labels`, { status: 200, data: { labels: [] } });
  mock.current.on('GET', `${BOARD}/activity`, {
    status: 200,
    data: { activities: [], nextCursor: null },
  });
  mock.current.on('GET', `${CARDS}/${t1.id}/comments`, {
    status: 200,
    data: { comments: [], nextCursor: null },
  });
  const result = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Sprint board', hidden: true });
  return result;
}

const views = (options: { hidden?: boolean } = {}) =>
  screen.getByRole('navigation', { name: 'Board views', ...options });

describe('top bar on a board page', () => {
  it('shows the logo, the board name and the view tabs with Board as the current one', async () => {
    await renderBoard();

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'StreamLine, your boards' })).toHaveAttribute(
      'href',
      '/boards',
    );
    expect(within(header).getByTestId('logo-mark').querySelectorAll('rect')).toHaveLength(3);
    expect(within(header).getByText('Sprint board')).toBeInTheDocument();

    const board = within(views()).getByRole('link', { name: 'Board' });
    expect(board).toHaveAttribute('href', BOARD);
    expect(board).toHaveAttribute('aria-current', 'page');
    const flow = within(views()).getByRole('link', { name: 'Flow' });
    expect(flow).toHaveAttribute('href', `${BOARD}/flow`);
    expect(flow).not.toHaveAttribute('aria-current');
    // Activity and Team open panels: buttons, never marked as the current page.
    for (const name of ['Activity', 'Team']) {
      expect(within(views()).getByRole('button', { name })).not.toHaveAttribute('aria-current');
    }
  });

  it('keeps Board current while a card is open over the board', async () => {
    await renderBoard('OWNER', `${BOARD}/cards/SB-1`);
    await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });

    expect(
      within(views({ hidden: true })).getByRole('link', { name: 'Board', hidden: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('goes to Flow from its tab, which then becomes the current one', async () => {
    const { router } = await renderBoard();
    mock.current.on('GET', `${BOARD}/analytics`, { status: 200, data: analyticsWith() });
    mock.current.on('GET', `${BOARD}/analytics/forecast`, {
      status: 200,
      data: countForecast(),
    });
    const flow = within(views()).getByRole('link', { name: 'Flow' });
    expect(screen.queryByText('Soon')).toBeNull();

    fireEvent.click(flow);

    expect(await screen.findByRole('heading', { level: 1, name: 'Flow' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`${BOARD}/flow`);
    expect(within(views()).getByRole('link', { name: 'Flow' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(views()).getByRole('link', { name: 'Board' })).not.toHaveAttribute(
      'aria-current',
    );
    // The board was already open: it is not loaded again.
    expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(1);
  });

  it('opens the board history from the Activity tab and returns focus to it', async () => {
    await renderBoard();
    const activity = within(views()).getByRole('button', { name: 'Activity' });
    expect(activity).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(activity);

    const panel = await screen.findByRole('dialog', { name: 'Activity' });
    expect(await within(panel).findByText(/No activity yet/i)).toBeInTheDocument();
    expect(mock.current.requestsTo('GET', `${BOARD}/activity`)).toHaveLength(1);

    fireEvent.keyDown(panel, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(activity).toHaveFocus());
    expect(activity).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the members dialog from the Team tab and returns focus to it', async () => {
    await renderBoard();
    const team = within(views()).getByRole('button', { name: 'Team' });

    fireEvent.click(team);

    const dialog = await screen.findByRole('dialog', { name: 'Members' });
    expect(within(dialog).getByRole('list', { name: 'Board members' })).toHaveTextContent(
      'Ola Nowak',
    );

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(team).toHaveFocus());
  });

  it('shows the board members as avatars', async () => {
    await renderBoard();

    const stack = within(screen.getByRole('banner')).getByRole('group', {
      name: 'Members of this board',
    });
    expect(within(stack).getByRole('img', { name: 'Ola Nowak' })).toBeInTheDocument();
  });

  it('has no board items on the board list', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mock.current.on('GET', '/boards', { status: 200, data: { boards: [boardWith()] } });
    renderApp('/boards');
    await screen.findByRole('heading', { level: 1, name: 'Your boards' });

    expect(screen.queryByRole('navigation', { name: 'Board views' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Members of this board' })).toBeNull();
  });
});

describe('board actions menu in the board header', () => {
  it.each<[BoardRole, string[]]>([
    ['OWNER', ['Rename', 'Delete']],
    ['ADMIN', ['Rename']],
  ])('offers %s the allowed actions', async (role, items) => {
    await renderBoard(role);

    const menu = await openMenu('Board actions');
    expect(menuItemNames(menu)).toEqual(items);
    closeMenu(menu);
  });

  it.each<BoardRole>(['MEMBER', 'VIEWER'])('is not shown to a %s', async (role) => {
    await renderBoard(role);

    expect(screen.queryByRole('button', { name: 'Board actions' })).toBeNull();
  });

  it('renames the board and returns focus to the menu button', async () => {
    await renderBoard('ADMIN');
    mock.current.on('PATCH', BOARD, {
      status: 200,
      data: { board: boardWith({ role: 'ADMIN', name: 'Release board' }) },
    });
    const trigger = screen.getByRole('button', { name: 'Board actions' });

    await chooseMenuItem('Board actions', 'Rename');
    const dialog = await screen.findByRole('dialog', { name: 'Rename board' });
    const input = within(dialog).getByLabelText('Board name');
    expect(input).toHaveValue('Sprint board');
    fireEvent.change(input, { target: { value: 'Release board' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Release board' }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Release board')).toBeInTheDocument();
    expect(mock.current.requestsTo('PATCH', BOARD)[0]?.data).toEqual({ name: 'Release board' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('deletes the board after confirmation and goes back to the board list', async () => {
    const { router } = await renderBoard('OWNER');
    mock.current.on('DELETE', BOARD, { status: 204 });
    mock.current.on('GET', '/boards', { status: 200, data: { boards: [] } });

    await chooseMenuItem('Board actions', 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete board "Sprint board"?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete board' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(mock.current.requestsTo('DELETE', BOARD)).toHaveLength(1);
    expect(await screen.findByText("You don't have any boards yet")).toBeInTheDocument();
  });
});
