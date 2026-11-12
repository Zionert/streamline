import type { BoardRole, Card } from '@streamline/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
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

const t1 = cardWith({
  id: 't1',
  number: 1,
  columnId: 'col-todo',
  rank: 'd',
  title: 'Fix login',
  description: 'Steps to reproduce',
  dueDate: '2026-12-01',
});
const p1 = cardWith({ id: 'p1', number: 3, columnId: 'col-progress', rank: 'h', title: 'Deploy' });

async function renderBoard(role: BoardRole = 'MEMBER', path = BOARD, cards: Card[] = [t1, p1]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role }), ola] },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), cards) });
  const result = renderApp(path);
  // An open modal hides the board from the accessibility tree.
  await screen.findByRole('heading', { level: 1, name: 'Board', hidden: true });
  return result;
}

const openDialog = () => screen.findByRole('dialog', { name: /^SB-1 Fix login/ });

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('card details', () => {
  it('opens from the board by clicking a card and closes with Escape', async () => {
    const { router } = await renderBoard();

    fireEvent.click(await screen.findByRole('button', { name: /^SB-1 / }));

    const dialog = await openDialog();
    expect(router.state.location.pathname).toBe('/boards/board-1/cards/SB-1');
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Fix login');
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Steps to reproduce');
    expect(within(dialog).getByLabelText('Status')).toHaveValue('col-todo');
    expect(within(dialog).getByLabelText('Assignee')).toHaveValue('');
    expect(within(dialog).getByLabelText('Priority')).toHaveValue('MEDIUM');
    expect(within(dialog).getByLabelText('Due date')).toHaveValue('2026-12-01');
    expect(dialog).toHaveTextContent(/Created \d{1,2} Nov 2026/);
    // The board stays rendered behind the modal.
    expect(screen.getByRole('heading', { level: 1, name: 'Board', hidden: true })).toBeTruthy();

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(router.state.location.pathname).toBe(BOARD));
    // Closing went back in history, so the browser's Back button does not reopen the card.
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens directly from the address and closes with the Close button', async () => {
    const { router } = await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(BOARD));
    // No board entry to go back to: the card's entry is replaced by the board.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('fetches a card that is not on the loaded board by its key', async () => {
    const late = cardWith({
      id: 'late',
      number: 7,
      columnId: 'col-done',
      rank: 'h',
      title: 'Late',
    });
    mock.current.on('GET', `${CARDS}/SB-7`, { status: 200, data: { card: late } });
    await renderBoard('MEMBER', `${BOARD}/cards/SB-7`);

    expect(await screen.findByRole('dialog', { name: /^SB-7 Late/ })).toBeVisible();
    expect(mock.current.requestsTo('GET', `${CARDS}/SB-7`)).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Done', hidden: true })).getByRole('button', {
        name: /^SB-7 /,
        hidden: true,
      }),
    ).toBeTruthy();
  });

  it('shows a friendly message for a card that does not exist', async () => {
    mock.current.on('GET', `${CARDS}/SB-99`, { status: 404, data: errorBody('NOT_FOUND') });
    const { router } = await renderBoard('MEMBER', `${BOARD}/cards/SB-99`);

    const dialog = await screen.findByRole('dialog', { name: 'Card not found' });
    expect(dialog).toHaveTextContent('The card SB-99 does not exist.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the board' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(BOARD));
  });

  it('treats a malformed key as not found without asking the server', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/not-a-key`);

    expect(await screen.findByRole('dialog', { name: 'Card not found' })).toBeVisible();
    expect(mock.current.requests.filter((request) => request.url.includes('not-a-key'))).toEqual(
      [],
    );
  });

  it('edits the title in place and sends only the title', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PATCH', `${CARDS}/t1`, {
      status: 200,
      data: { card: { ...t1, title: 'Fix the login form' } },
    });
    const dialog = await openDialog();
    const title = within(dialog).getByLabelText('Title');

    fireEvent.change(title, { target: { value: ' Fix the login form ' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    await waitFor(() =>
      expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)[0]?.data).toEqual({
        title: 'Fix the login form',
      }),
    );
    expect(
      await screen.findByRole('button', { name: /^SB-1 Fix the login form/, hidden: true }),
    ).toBeTruthy();
    expect(within(await screen.findByRole('dialog')).getByLabelText('Title')).toHaveValue(
      'Fix the login form',
    );
  });

  it('rejects an empty title and discards an edit with Escape without closing', async () => {
    const { router } = await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const dialog = await openDialog();
    const title = within(dialog).getByLabelText('Title');

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Card title is required');

    title.focus();
    fireEvent.keyDown(title, { key: 'Escape' });

    expect(title).toHaveValue('Fix login');
    expect(router.state.location.pathname).toBe(`${BOARD}/cards/SB-1`);
    expect(mock.current.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('saves the description when leaving the field', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PATCH', `${CARDS}/t1`, {
      status: 200,
      data: { card: { ...t1, description: null } },
    });
    const dialog = await openDialog();
    const description = within(dialog).getByLabelText('Description');

    fireEvent.change(description, { target: { value: '  ' } });
    fireEvent.blur(description);

    await waitFor(() =>
      expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)[0]?.data).toEqual({
        description: null,
      }),
    );
  });

  it('changes the assignee, priority and due date one field at a time', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on(
      'PATCH',
      `${CARDS}/t1`,
      { status: 200, data: { card: { ...t1, assigneeId: 'user-ola' } } },
      { status: 200, data: { card: { ...t1, assigneeId: 'user-ola', priority: 'URGENT' } } },
      {
        status: 200,
        data: { card: { ...t1, assigneeId: 'user-ola', priority: 'URGENT', dueDate: null } },
      },
    );
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByLabelText('Assignee'), {
      target: { value: 'user-ola' },
    });
    expect(within(dialog).getByLabelText('Assignee')).toHaveValue('user-ola');
    await waitFor(() => expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)).toHaveLength(1));

    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'URGENT' } });
    await waitFor(() => expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)).toHaveLength(2));

    const dueDate = within(dialog).getByLabelText('Due date');
    fireEvent.change(dueDate, { target: { value: '' } });
    fireEvent.blur(dueDate);
    await waitFor(() => expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)).toHaveLength(3));

    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`).map((request) => request.data)).toEqual([
      { assigneeId: 'user-ola' },
      { priority: 'URGENT' },
      { dueDate: null },
    ]);
    expect(
      screen.getByRole('button', {
        name: 'SB-1 Fix login, priority Urgent, assigned to Ola Nowak',
        hidden: true,
      }),
    ).toBeTruthy();
  });

  it('saves the due date on Enter or blur only, not while it is being typed', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PATCH', `${CARDS}/t1`, {
      status: 200,
      data: { card: { ...t1, dueDate: '2027-01-15' } },
    });
    const dialog = await openDialog();
    const dueDate = within(dialog).getByLabelText('Due date');

    // Intermediate values reported by the browser while the year is typed.
    for (const value of ['0002-01-15', '0020-01-15', '0202-01-15', '2027-01-15']) {
      fireEvent.change(dueDate, { target: { value } });
    }
    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1`)).toHaveLength(0);

    fireEvent.keyDown(dueDate, { key: 'Enter' });
    fireEvent.blur(within(dialog).getByLabelText('Due date'));

    await waitFor(() =>
      expect(
        mock.current.requestsTo('PATCH', `${CARDS}/t1`).map((request) => request.data),
      ).toEqual([{ dueDate: '2027-01-15' }]),
    );
  });

  it('discards a typed due date with Escape without closing', async () => {
    const { router } = await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const dialog = await openDialog();
    const dueDate = within(dialog).getByLabelText('Due date');

    fireEvent.change(dueDate, { target: { value: '2027-01-15' } });
    dueDate.focus();
    fireEvent.keyDown(dueDate, { key: 'Escape' });
    fireEvent.blur(dueDate);

    expect(dueDate).toHaveValue('2026-12-01');
    expect(router.state.location.pathname).toBe(`${BOARD}/cards/SB-1`);
    expect(mock.current.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  });

  it('restores the assignee and explains ASSIGNEE_NOT_MEMBER', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PATCH', `${CARDS}/t1`, {
      status: 400,
      data: errorBody('ASSIGNEE_NOT_MEMBER'),
    });
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByLabelText('Assignee'), {
      target: { value: 'user-ola' },
    });

    expect(
      await screen.findByText('The assignee must be a member of this board.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Assignee')).toHaveValue('');
  });

  it('moves the card to the end of another column through the status field', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 200,
      data: { card: { ...t1, columnId: 'col-progress', rank: 'p' } },
    });
    const dialog = await openDialog();

    fireEvent.change(within(dialog).getByLabelText('Status'), {
      target: { value: 'col-progress' },
    });

    await waitFor(() =>
      expect(mock.current.requestsTo('PATCH', `${CARDS}/t1/move`)[0]?.data).toEqual({
        columnId: 'col-progress',
        afterId: 'p1',
        beforeId: null,
      }),
    );
    expect(within(dialog).getByLabelText('Status')).toHaveValue('col-progress');
  });

  it('copies the link to the card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText('Link copied to the clipboard.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/boards/board-1/cards/SB-1`);
  });

  it('deletes the card after confirmation and returns to the board', async () => {
    const { router } = await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('DELETE', `${CARDS}/t1`, { status: 204 });
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete card SB-1?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete card' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(BOARD));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /^SB-1 / })).toBeNull();
    expect(mock.current.requestsTo('DELETE', `${CARDS}/t1`)).toHaveLength(1);
    expect(mock.current.requestsTo('GET', `${CARDS}/SB-1`)).toHaveLength(0);
  });

  it('shows the details read-only to a VIEWER', async () => {
    await renderBoard('VIEWER', `${BOARD}/cards/SB-1`);
    const dialog = await openDialog();

    expect(within(dialog).queryByLabelText('Title')).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Fix login' })).toBeVisible();
    expect(within(dialog).queryByLabelText('Description')).toBeNull();
    expect(within(dialog).getByText('Steps to reproduce')).toBeVisible();
    expect(within(dialog).getByLabelText('Status')).toBeDisabled();
    expect(within(dialog).getByLabelText('Assignee')).toBeDisabled();
    expect(within(dialog).getByLabelText('Priority')).toBeDisabled();
    expect(within(dialog).getByText('1 Dec 2026')).toBeVisible();
    // A read-only value is not given a <label> (labels are for form controls).
    expect(within(dialog).queryByLabelText('Due date')).toBeNull();
    expect(within(dialog).getByText('Due date').closest('label')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeVisible();
  });
});
