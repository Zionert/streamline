import type { BoardRole, Card, Column } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import {
  boardWith,
  cardListFor,
  columnWith,
  defaultColumns,
  memberWith,
  sessionWith,
  testUser,
} from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { chooseMenuItem, closeMenu, menuItemNames, openMenu } from '@/test/menu';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const COLUMNS = `${BOARD}/columns`;
const MEMBERS = `${BOARD}/members`;
const CARDS = `${BOARD}/cards`;

const owner = memberWith({ userId: 'user-owner', name: 'Olga Owner', email: 'olga@example.com' });
const admin = memberWith({
  userId: 'user-admin',
  name: 'Adam Admin',
  email: 'adam@example.com',
  role: 'ADMIN',
});
const viewer = memberWith({
  userId: 'user-viewer',
  name: 'Vera Viewer',
  email: 'vera@example.com',
  role: 'VIEWER',
});

/** Opens board-1 as the test user with the given role (the user is listed among the members). */
async function renderBoard(
  role: BoardRole,
  columns: Column[] = defaultColumns(),
  options: { strict?: boolean; cards?: Card[]; path?: string } = {},
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  const self = memberWith({ role });
  const others = [owner, admin, viewer].filter((member) => member.role !== role);
  const members = role === 'OWNER' ? [self, admin, viewer] : [...others, self];
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', COLUMNS, { status: 200, data: { columns } });
  mock.current.on('GET', MEMBERS, { status: 200, data: { members } });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(columns, options.cards) });
  const result = renderApp(options.path ?? BOARD, options);
  await screen.findByRole('heading', { level: 1, name: 'Board' });
  return result;
}

const columnTitles = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

const columnRegion = (title: string) => screen.getByRole('region', { name: title });

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Drags a column with the keyboard: lift with space, move with arrows, drop with space. */
async function dragColumn(title: string, steps: number) {
  const handle = screen.getByRole('button', { name: `Drag column ${title}` });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await flush();
  const arrow = steps > 0 ? 'ArrowRight' : 'ArrowLeft';
  for (let step = 0; step < Math.abs(steps); step += 1) {
    fireEvent.keyDown(handle, { key: arrow, code: arrow, keyCode: steps > 0 ? 39 : 37 });
    await flush();
  }
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await flush();
}

/** Names of the items in the actions menu of a column (the menu is closed again). */
async function columnMenuItems(title: string): Promise<string[]> {
  const menu = await openMenu(`Actions for column ${title}`);
  const names = menuItemNames(menu);
  closeMenu(menu);
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return names;
}

async function openMembers() {
  fireEvent.click(screen.getByRole('button', { name: 'Members' }));
  return screen.findByRole('dialog', { name: 'Members' });
}

describe('BoardPage: layout', () => {
  it('shows the columns in rank order with category and WIP counter', async () => {
    const columns = defaultColumns();
    await renderBoard('MEMBER', [columns[3]!, columns[1]!, columns[0]!, columns[2]!]);

    expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    expect(columnRegion('Backlog')).toHaveTextContent('Category: Backlog');
    expect(columnRegion('To Do')).toHaveTextContent('Category: To do');
    expect(columnRegion('In Progress')).toHaveTextContent('Category: In progress');
    expect(columnRegion('Done')).toHaveTextContent('Category: Done');
    expect(within(columnRegion('In Progress')).getByLabelText('WIP 0 of 3')).toHaveTextContent(
      '0 / 3',
    );
    expect(within(columnRegion('To Do')).queryByLabelText(/^WIP/)).toBeNull();
    expect(within(columnRegion('To Do')).getByText('(0)')).toBeInTheDocument();
    expect(within(columnRegion('Done')).getByText('No cards')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeVisible();
  });

  it('shows breadcrumbs and the toolbar', async () => {
    const { router } = await renderBoard('OWNER');

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByText('Sprint board')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('searchbox', { name: 'Filter cards' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sort' })).toBeDisabled();
    const quickAdd = screen.getAllByRole('button', { name: /^Add a card to/ });
    expect(quickAdd).toHaveLength(4);
    quickAdd.forEach((button) => expect(button).toBeEnabled());

    fireEvent.click(within(breadcrumb).getByRole('link', { name: 'Boards' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
  });

  it('toggles the filter text and member highlight without server requests', async () => {
    await renderBoard('OWNER');
    const filter = screen.getByRole('searchbox', { name: 'Filter cards' });

    fireEvent.change(filter, { target: { value: 'login' } });
    const stack = screen.getByRole('group', { name: 'Board members' });
    const adam = within(stack).getByRole('button', { name: 'Adam Admin' });
    expect(adam).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(adam);

    expect(filter).toHaveValue('login');
    expect(adam).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(adam);
    expect(adam).toHaveAttribute('aria-pressed', 'false');
    // Filtering is view-only: nothing is sent to the server.
    expect(mock.current.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('shows at most four member avatars and a "+N" counter', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    const members = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter) =>
      memberWith({ userId: `user-${letter}`, name: `${letter} Person`, role: 'MEMBER' }),
    );
    mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role: 'MEMBER' }) } });
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: defaultColumns() } });
    mock.current.on('GET', MEMBERS, { status: 200, data: { members } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns()) });
    renderApp(BOARD);

    const stack = await screen.findByRole('group', { name: 'Board members' });
    expect(within(stack).getAllByRole('button')).toHaveLength(4);
    expect(
      within(stack).getByRole('img', { name: '2 more: E Person, F Person' }),
    ).toHaveTextContent('+2');
  });

  it('shows skeleton columns while the board is loading', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    const reply = deferred<MockReply>();
    mock.current.on('GET', BOARD, () => reply.promise);
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: defaultColumns() } });
    mock.current.on('GET', MEMBERS, { status: 200, data: { members: [] } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns()) });
    renderApp(BOARD);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading board...');
    expect(screen.getAllByTestId('column-skeleton')).toHaveLength(4);
    reply.resolve({ status: 200, data: { board: boardWith({ role: 'VIEWER' }) } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
    expect(screen.queryByTestId('column-skeleton')).toBeNull();
  });

  it('shows a friendly state for a board the user cannot see', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mock.current.on('GET', BOARD, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', COLUMNS, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', MEMBERS, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', CARDS, { status: 404, data: errorBody('NOT_FOUND') });
    const { router } = renderApp(BOARD);

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Back to your boards' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
  });

  it('offers a retry when the board cannot be loaded', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mock.current.on('GET', BOARD, 'network-error', {
      status: 200,
      data: { board: boardWith({ role: 'VIEWER' }) },
    });
    mock.current.on('GET', COLUMNS, { status: 200, data: { columns: defaultColumns() } });
    mock.current.on('GET', MEMBERS, { status: 200, data: { members: [] } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns()) });
    renderApp(BOARD);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load the board/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
  });
});

describe('BoardPage: permissions', () => {
  it('shows a VIEWER no controls that change the board', async () => {
    await renderBoard('VIEWER');

    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Add column' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Drag column/ })).toBeNull();
    // Board settings are for managers only.
    expect(screen.queryByRole('button', { name: /^Settings/ })).toBeNull();

    const dialog = await openMembers();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
    expect(within(dialog).queryByRole('form', { name: 'Add member' })).toBeNull();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Leave board' })).toBeVisible();
  });

  it('lets a MEMBER edit columns but not their settings or the members', async () => {
    await renderBoard('MEMBER');

    expect(screen.getByRole('button', { name: 'Add column' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Actions for column/ })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^Drag column/ })).toHaveLength(4);
    expect(await columnMenuItems('To Do')).toEqual(['Rename', 'Delete']);
    expect(await columnMenuItems('Done')).toEqual(['Rename', 'Delete']);

    const dialog = await openMembers();
    expect(within(dialog).queryByRole('form', { name: 'Add member' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('keeps column headings and counters outside the drag handles', async () => {
    await renderBoard('MEMBER');

    const handles = screen.getAllByRole('button', { name: /^Drag column/ });
    expect(handles).toHaveLength(4);
    handles.forEach((handle) => expect(handle).toHaveTextContent(''));
    // Children of a role="button" are presentational: headings and counters must stay outside.
    for (const heading of screen.getAllByRole('heading', { level: 2 })) {
      expect(heading.closest('[role="button"]')).toBeNull();
    }
    expect(screen.getByLabelText('WIP 0 of 3').closest('[role="button"]')).toBeNull();
  });

  it('gives an OWNER every control except leaving the board', async () => {
    await renderBoard('OWNER');

    expect(screen.getByRole('button', { name: 'Add column' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Actions for column/ })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^Drag column/ })).toHaveLength(4);
    expect(await columnMenuItems('Backlog')).toEqual(['Rename', 'Settings', 'Delete']);

    const dialog = await openMembers();
    expect(within(dialog).getByRole('form', { name: 'Add member' })).toBeVisible();
    expect(within(dialog).getByLabelText('Role of Adam Admin')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Remove Vera Viewer' })).toBeVisible();
    // No controls on the own row, and the owner cannot leave.
    expect(within(dialog).queryByLabelText(`Role of ${testUser.name}`)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Leave board' })).toBeNull();
  });

  it('lets an ADMIN manage everyone except the owner', async () => {
    await renderBoard('ADMIN');

    expect(await columnMenuItems('In Progress')).toEqual(['Rename', 'Settings', 'Delete']);
    const dialog = await openMembers();
    expect(within(dialog).queryByLabelText('Role of Olga Owner')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Remove Olga Owner' })).toBeNull();
    expect(within(dialog).getByLabelText('Role of Vera Viewer')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Leave board' })).toBeVisible();
  });
});

describe('BoardPage: columns', () => {
  it('adds a column at the end', async () => {
    await renderBoard('MEMBER');
    mock.current.on('POST', COLUMNS, {
      status: 201,
      data: { column: columnWith({ id: 'col-qa', title: 'QA', rank: 'z' }) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const form = screen.getByRole('form', { name: 'Add column' });
    fireEvent.change(within(form).getByLabelText('New column'), { target: { value: ' QA ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add column' }));

    await waitFor(() =>
      expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'QA']),
    );
    expect(mock.current.requestsTo('POST', COLUMNS)[0]?.data).toEqual({ title: 'QA' });
    expect(screen.getByLabelText('New column')).toHaveValue('');
  });

  it('renames a column inline with Enter', async () => {
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${COLUMNS}/col-todo`, {
      status: 200,
      data: { column: columnWith({ id: 'col-todo', title: 'Ready', rank: 'h' }) },
    });

    await chooseMenuItem('Actions for column To Do', 'Rename');
    const input = screen.getByLabelText('Column title');
    expect(input).toHaveValue('To Do');
    expect(input).toHaveFocus();
    expect(input.closest('[role="button"]')).toBeNull();
    fireEvent.change(input, { target: { value: 'Ready ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(columnTitles()).toEqual(['Backlog', 'Ready', 'In Progress', 'Done']);
    await waitFor(() =>
      expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-todo`)[0]?.data).toEqual({
        title: 'Ready',
      }),
    );
  });

  it('cancels inline rename with Escape and rejects an empty title', async () => {
    await renderBoard('MEMBER');

    await chooseMenuItem('Actions for column To Do', 'Rename');
    const input = screen.getByLabelText('Column title');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByRole('alert')).toHaveTextContent('Column title is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByLabelText('Column title')).toBeNull();
    expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    expect(mock.current.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('restores the title and explains when renaming fails', async () => {
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${COLUMNS}/col-todo`, {
      status: 503,
      data: errorBody('BOARD_BUSY'),
    });

    await chooseMenuItem('Actions for column To Do', 'Rename');
    const input = screen.getByLabelText('Column title');
    fireEvent.change(input, { target: { value: 'Ready' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The rename was optimistic, so the failure is reported as a toast.
    expect(await screen.findByText(/busy/i)).toBeInTheDocument();
    expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('deletes a column after confirmation and explains LAST_DONE_COLUMN', async () => {
    await renderBoard('MEMBER');
    mock.current.on('DELETE', `${COLUMNS}/col-done`, {
      status: 409,
      data: errorBody('LAST_DONE_COLUMN'),
    });
    mock.current.on('DELETE', `${COLUMNS}/col-backlog`, { status: 204 });

    await chooseMenuItem('Actions for column Done', 'Delete');
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete column' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/at least one Done column/i);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await chooseMenuItem('Actions for column Backlog', 'Delete');
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete column' }));

    await waitFor(() => expect(columnTitles()).toEqual(['To Do', 'In Progress', 'Done']));
  });
});

describe('BoardPage: column settings', () => {
  async function openSettings(title: string) {
    await chooseMenuItem(`Actions for column ${title}`, 'Settings');
    return screen.findByRole('dialog', { name: 'Column settings' });
  }

  it('returns focus to the column menu button when the dialog closes', async () => {
    await renderBoard('OWNER');

    const dialog = await openSettings('To Do');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions for column To Do' })).toHaveFocus(),
    );

    await chooseMenuItem('Actions for column Done', 'Delete');
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions for column Done' })).toHaveFocus(),
    );
  });

  it('saves only the changed settings', async () => {
    await renderBoard('ADMIN');
    mock.current.on('PATCH', `${COLUMNS}/col-todo/settings`, {
      status: 200,
      data: {
        column: columnWith({
          id: 'col-todo',
          title: 'To Do',
          rank: 'h',
          wipLimit: 4,
          wipStrict: true,
        }),
      },
    });

    const dialog = await openSettings('To Do');
    expect(within(dialog).getByLabelText('Category')).toHaveValue('TODO');
    fireEvent.change(within(dialog).getByLabelText('WIP limit'), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /strict wip limit/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-todo/settings`)[0]?.data).toEqual({
      wipLimit: 4,
      wipStrict: true,
    });
    expect(within(columnRegion('To Do')).getByLabelText('WIP 0 of 4')).toBeVisible();
  });

  it('removes the WIP limit when the field is emptied', async () => {
    await renderBoard('OWNER');
    mock.current.on('PATCH', `${COLUMNS}/col-progress/settings`, {
      status: 200,
      data: {
        column: columnWith({ id: 'col-progress', title: 'In Progress', rank: 'p', wipLimit: null }),
      },
    });

    const dialog = await openSettings('In Progress');
    fireEvent.change(within(dialog).getByLabelText('WIP limit'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-progress/settings`)[0]?.data).toEqual({
      wipLimit: null,
    });
  });

  it('rejects an invalid WIP limit without sending a request', async () => {
    await renderBoard('OWNER');

    const dialog = await openSettings('To Do');
    fireEvent.change(within(dialog).getByLabelText('WIP limit'), { target: { value: '1000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/from 1 to 999/);
    expect(within(dialog).getByLabelText('WIP limit')).toHaveAttribute('aria-invalid', 'true');
    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-todo/settings`)).toHaveLength(0);
  });

  it('explains LAST_DONE_COLUMN when re-categorising the last Done column', async () => {
    await renderBoard('OWNER');
    mock.current.on('PATCH', `${COLUMNS}/col-done/settings`, {
      status: 409,
      data: errorBody('LAST_DONE_COLUMN'),
    });

    const dialog = await openSettings('Done');
    fireEvent.change(within(dialog).getByLabelText('Category'), {
      target: { value: 'IN_PROGRESS' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/at least one Done column/i);
    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-done/settings`)[0]?.data).toEqual({
      category: 'IN_PROGRESS',
    });
  });
});

describe('BoardPage: drag & drop', () => {
  it('reorders optimistically and sends the new neighbours', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await renderBoard('MEMBER');
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${COLUMNS}/col-backlog/move`, () => reply.promise);

    await dragColumn('Backlog', 2);

    // Shown in the new place before the server answers.
    expect(columnTitles()).toEqual(['To Do', 'In Progress', 'Backlog', 'Done']);
    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-backlog/move`)[0]?.data).toEqual({
      afterId: 'col-progress',
      beforeId: 'col-done',
    });
    reply.resolve({
      status: 200,
      data: {
        column: columnWith({ id: 'col-backlog', title: 'Backlog', rank: 't', category: 'BACKLOG' }),
      },
    });
    await flush();

    expect(columnTitles()).toEqual(['To Do', 'In Progress', 'Backlog', 'Done']);
    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('rolls back and shows an error when the server rejects the move', async () => {
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${COLUMNS}/col-done/move`, {
      status: 503,
      data: errorBody('BOARD_BUSY'),
    });

    await dragColumn('Done', -3);

    expect(mock.current.requestsTo('PATCH', `${COLUMNS}/col-done/move`)[0]?.data).toEqual({
      afterId: null,
      beforeId: 'col-backlog',
    });
    expect(await screen.findByText(/busy/i)).toBeInTheDocument();
    expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    // The notice is shown once as a toast and cleared from the store.
    expect(useBoardStore.getState().notice).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close toast' }));
    await waitFor(() => expect(screen.queryByText(/busy/i)).toBeNull());
  });

  it('shows exactly one toast per notice under StrictMode', async () => {
    await renderBoard('MEMBER', defaultColumns(), { strict: true });
    mock.current.on('PATCH', `${COLUMNS}/col-done/move`, {
      status: 503,
      data: errorBody('BOARD_BUSY'),
    });

    await dragColumn('Done', -3);

    expect(await screen.findByText(/busy/i)).toBeInTheDocument();
    await flush();
    expect(screen.getAllByText(/busy/i)).toHaveLength(1);
    expect(useBoardStore.getState().notice).toBeNull();
  });

  it('reloads the columns after 409 INVALID_POSITION', async () => {
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${COLUMNS}/col-todo/move`, {
      status: 409,
      data: errorBody('INVALID_POSITION'),
    });
    mock.current.on('GET', COLUMNS, {
      status: 200,
      data: {
        columns: [...defaultColumns(), columnWith({ id: 'col-qa', title: 'QA', rank: 'y' })],
      },
    });

    await dragColumn('To Do', 1);

    expect(await screen.findByText(/refreshed/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(columnTitles()).toEqual(['Backlog', 'To Do', 'In Progress', 'Done', 'QA']),
    );
    expect(mock.current.requestsTo('GET', COLUMNS)).toHaveLength(2);
  });
});

describe('BoardPage: members', () => {
  it('adds a member by email and explains USER_NOT_FOUND and ALREADY_MEMBER', async () => {
    await renderBoard('OWNER');
    const newcomer = memberWith({
      userId: 'user-new',
      name: 'Nina New',
      email: 'nina@example.com',
      role: 'VIEWER',
    });
    mock.current.on(
      'POST',
      MEMBERS,
      { status: 404, data: errorBody('USER_NOT_FOUND') },
      { status: 409, data: errorBody('ALREADY_MEMBER') },
      { status: 201, data: { member: newcomer } },
    );
    const dialog = await openMembers();
    const form = within(dialog).getByRole('form', { name: 'Add member' });
    const submit = () => fireEvent.click(within(form).getByRole('button', { name: 'Add member' }));

    fireEvent.change(within(form).getByLabelText('Email'), {
      target: { value: 'nina@example.com' },
    });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'VIEWER' } });
    submit();
    expect(await within(form).findByRole('alert')).toHaveTextContent(/no registered user/i);

    submit();
    await waitFor(() =>
      expect(within(form).getByRole('alert')).toHaveTextContent(/already a member/i),
    );

    submit();
    expect(await within(dialog).findByText('Nina New')).toBeVisible();
    expect(mock.current.requestsTo('POST', MEMBERS)[2]?.data).toEqual({
      email: 'nina@example.com',
      role: 'VIEWER',
    });
  });

  it('changes the role of a member and removes a member', async () => {
    await renderBoard('OWNER');
    mock.current.on('PATCH', `${MEMBERS}/user-viewer`, {
      status: 200,
      data: { member: { ...viewer, role: 'MEMBER' } },
    });
    mock.current.on('DELETE', `${MEMBERS}/user-admin`, { status: 204 });
    const dialog = await openMembers();

    fireEvent.change(within(dialog).getByLabelText('Role of Vera Viewer'), {
      target: { value: 'MEMBER' },
    });
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Role of Vera Viewer')).toHaveValue('MEMBER'),
    );
    expect(mock.current.requestsTo('PATCH', `${MEMBERS}/user-viewer`)[0]?.data).toEqual({
      role: 'MEMBER',
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Adam Admin' }));
    let confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Remove Adam Admin from the board?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mock.current.requestsTo('DELETE', `${MEMBERS}/user-admin`)).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Adam Admin' }));
    confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove member' }));

    await waitFor(() => expect(within(dialog).queryByText('Adam Admin')).toBeNull());
    expect(mock.current.requestsTo('DELETE', `${MEMBERS}/user-admin`)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('leaves the board and returns to the board list', async () => {
    const { router } = await renderBoard('MEMBER');
    mock.current.on('DELETE', `${MEMBERS}/${testUser.id}`, { status: 204 });
    const dialog = await openMembers();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave board' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Leave board' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(mock.current.requestsTo('DELETE', `${MEMBERS}/${testUser.id}`)).toHaveLength(1);
    expect(await screen.findByRole('heading', { name: 'Your boards' })).toBeVisible();
  });

  it('explains OWNER_CANNOT_LEAVE', async () => {
    await renderBoard('MEMBER');
    mock.current.on('DELETE', `${MEMBERS}/${testUser.id}`, {
      status: 409,
      data: errorBody('OWNER_CANNOT_LEAVE'),
    });
    const dialog = await openMembers();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave board' }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Leave board' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent(/owner cannot leave/i);
  });
});
