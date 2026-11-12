import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { boardWith, sessionWith } from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { chooseMenuItem, closeMenu, menuItemNames, openMenu } from '@/test/menu';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const ownedBoard = boardWith({ id: 'b-own', name: 'Product roadmap', role: 'OWNER' });
const adminBoard = boardWith({ id: 'b-admin', name: 'Marketing', role: 'ADMIN' });
const viewedBoard = boardWith({ id: 'b-view', name: 'Company wiki', role: 'VIEWER' });

function renderBoards(boards = [ownedBoard, adminBoard, viewedBoard]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', '/boards', { status: 200, data: { boards } });
  return renderApp('/boards');
}

function boardItem(name: string): HTMLElement {
  const link = screen.getByRole('link', { name });
  const item = link.closest('li');
  if (!item) {
    throw new Error(`No list item for board ${name}`);
  }
  return item;
}

describe('BoardsPage', () => {
  it('is the landing page of a logged-in user', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));

    const { router } = renderApp('/');

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect(await screen.findByText("You don't have any boards yet")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your boards' })).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText('Boards'),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('shows an empty state whose button opens the create dialog', async () => {
    renderBoards([]);

    expect(await screen.findByText("You don't have any boards yet")).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Boards' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first board' }));

    expect(await screen.findByRole('dialog', { name: 'Create board' })).toBeVisible();
  });

  it('lists the boards with the role of the user and links to them', async () => {
    renderBoards();

    const list = await screen.findByRole('list', { name: 'Boards' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(boardItem('Product roadmap')).getByText('Owner')).toBeInTheDocument();
    expect(within(boardItem('Marketing')).getByText('Admin')).toBeInTheDocument();
    expect(within(boardItem('Company wiki')).getByText('Viewer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Product roadmap' })).toHaveAttribute(
      'href',
      '/boards/b-own',
    );
  });

  it('shows rename and delete only when the role allows them', async () => {
    renderBoards();
    await screen.findByRole('list', { name: 'Boards' });

    let menu = await openMenu('Actions for board Product roadmap');
    expect(menuItemNames(menu)).toEqual(['Rename', 'Delete']);
    closeMenu(menu);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    menu = await openMenu('Actions for board Marketing');
    expect(menuItemNames(menu)).toEqual(['Rename']);
    closeMenu(menu);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // A viewer can do neither, so the board has no actions menu at all.
    expect(screen.queryByRole('button', { name: 'Actions for board Company wiki' })).toBeNull();
  });

  it('shows a loading state, then an error with retry', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    const reply = deferred<MockReply>();
    mock.current.on('GET', '/boards', () => reply.promise, {
      status: 200,
      data: { boards: [ownedBoard] },
    });
    renderApp('/boards');

    expect(screen.getByRole('status')).toHaveTextContent('Loading boards...');
    expect(screen.getAllByTestId('board-skeleton')).toHaveLength(3);
    reply.resolve({ status: 500, data: errorBody('INTERNAL_ERROR') });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your boards/i);
    expect(screen.queryByTestId('board-skeleton')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: 'Product roadmap' })).toBeInTheDocument();
  });

  it('creates a board', async () => {
    renderBoards([]);
    await screen.findByText("You don't have any boards yet");
    mock.current.on('POST', '/boards', {
      status: 201,
      data: { board: boardWith({ id: 'b-new', name: 'Sprint 12' }) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create board' });
    fireEvent.change(within(dialog).getByLabelText('New board name'), {
      target: { value: ' Sprint 12 ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create board' }));

    expect(await screen.findByRole('link', { name: 'Sprint 12' })).toBeInTheDocument();
    expect(mock.current.requestsTo('POST', '/boards')[0]?.data).toEqual({ name: 'Sprint 12' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rejects an empty board name without sending a request', async () => {
    renderBoards([]);
    await screen.findByText("You don't have any boards yet");

    fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create board' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create board' }));

    expect(await within(dialog).findByText('Board name is required')).toBeInTheDocument();
    expect(mock.current.requestsTo('POST', '/boards')).toHaveLength(0);
  });

  it('renames a board in a dialog', async () => {
    renderBoards();
    await screen.findByRole('list', { name: 'Boards' });
    mock.current.on('PATCH', '/boards/b-admin', {
      status: 200,
      data: { board: { ...adminBoard, name: 'Growth' } },
    });

    await chooseMenuItem('Actions for board Marketing', 'Rename');
    const dialog = await screen.findByRole('dialog', { name: 'Rename board' });
    const input = within(dialog).getByLabelText('Board name');
    expect(input).toHaveValue('Marketing');
    fireEvent.change(input, { target: { value: 'Growth' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('link', { name: 'Growth' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.current.requestsTo('PATCH', '/boards/b-admin')[0]?.data).toEqual({
      name: 'Growth',
    });
  });

  it('returns focus to the board menu button when a dialog closes', async () => {
    renderBoards();
    await screen.findByRole('list', { name: 'Boards' });
    const trigger = screen.getByRole('button', { name: 'Actions for board Marketing' });

    await chooseMenuItem('Actions for board Marketing', 'Rename');
    fireEvent.keyDown(await screen.findByRole('dialog', { name: 'Rename board' }), {
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());

    const ownTrigger = screen.getByRole('button', { name: 'Actions for board Product roadmap' });
    await chooseMenuItem('Actions for board Product roadmap', 'Delete');
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(ownTrigger).toHaveFocus());
  });

  it('deletes a board only after confirmation', async () => {
    renderBoards();
    await screen.findByRole('list', { name: 'Boards' });
    mock.current.on('DELETE', '/boards/b-own', { status: 204 });

    await chooseMenuItem('Actions for board Product roadmap', 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete board "Product roadmap"?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mock.current.requestsTo('DELETE', '/boards/b-own')).toHaveLength(0);

    await chooseMenuItem('Actions for board Product roadmap', 'Delete');
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete board' }),
    );

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Product roadmap' })).toBeNull());
    expect(mock.current.requestsTo('DELETE', '/boards/b-own')).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the confirmation open with an error when deleting fails', async () => {
    renderBoards();
    await screen.findByRole('list', { name: 'Boards' });
    mock.current.on('DELETE', '/boards/b-own', { status: 403, data: errorBody('FORBIDDEN') });

    await chooseMenuItem('Actions for board Product roadmap', 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete board' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/permission/i);
    // The open modal hides the page from the accessibility tree.
    expect(screen.getByRole('link', { name: 'Product roadmap', hidden: true })).toBeInTheDocument();
  });
});
