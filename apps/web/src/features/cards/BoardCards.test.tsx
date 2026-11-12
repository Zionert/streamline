import type { BoardRole, Card } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { stubBoardLayout } from '@/test/boardLayout';
import {
  boardWith,
  cardListFor,
  cardWith,
  columnWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { chooseMenuItem } from '@/test/menu';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
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
const t2 = cardWith({
  id: 't2',
  number: 2,
  columnId: 'col-todo',
  rank: 'k',
  title: 'Write docs',
  priority: 'HIGH',
  assigneeId: 'user-ola',
});
const p1 = cardWith({ id: 'p1', number: 3, columnId: 'col-progress', rank: 'h', title: 'Deploy' });
const initialCards = [t1, t2, p1];

async function renderBoard(
  role: BoardRole = 'MEMBER',
  options: { cards?: Card[]; path?: string; columns?: ReturnType<typeof defaultColumns> } = {},
) {
  const columns = options.columns ?? defaultColumns();
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role }), ola] },
  });
  mock.current.on('GET', CARDS, {
    status: 200,
    data: cardListFor(columns, options.cards ?? initialCards),
  });
  const result = renderApp(options.path ?? BOARD);
  await screen.findByRole('heading', { level: 1, name: 'Board' });
  await screen.findAllByRole('button', { name: /^SB-\d/ });
  return result;
}

const columnRegion = (title: string) => screen.getByRole('region', { name: title });

const cardKeysIn = (title: string) =>
  within(columnRegion(title))
    .queryAllByRole('button', { name: /^SB-\d/ })
    .map((tile) => tile.getAttribute('data-card-key'));

const tile = (key: string) => screen.getByRole('button', { name: new RegExp(`^${key} `) });

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
const KEY_CODES: Record<Arrow, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

/** Drags a card with the keyboard: lift with space, move with arrows, drop with space. */
async function dragCard(key: string, arrows: Arrow[]) {
  const handle = tile(key);
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await flush();
  for (const arrow of arrows) {
    fireEvent.keyDown(handle, { key: arrow, code: arrow, keyCode: KEY_CODES[arrow] });
    await flush();
  }
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await flush();
}

describe('cards on the board', () => {
  it('shows the cards in their columns with real counters and the WIP highlight', async () => {
    const extra = [2, 3, 4].map((number) =>
      cardWith({
        id: `p${String(number)}`,
        number: 10 + number,
        columnId: 'col-progress',
        rank: `p${String(number)}`,
      }),
    );
    await renderBoard('MEMBER', { cards: [...initialCards, ...extra] });

    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
    expect(within(columnRegion('To Do')).getByText('(2)')).toBeInTheDocument();
    // In Progress has a WIP limit of 3 and four cards.
    const progress = columnRegion('In Progress');
    expect(within(progress).getByLabelText('WIP 4 of 3, limit exceeded')).toBeInTheDocument();
    expect(progress).toHaveAttribute('data-wip-exceeded', 'true');
    expect(within(columnRegion('Done')).getByText('No cards')).toBeInTheDocument();
    expect(tile('SB-2')).toHaveAccessibleName(
      'SB-2 Write docs, priority High, assigned to Ola Nowak',
    );
  });

  it('shows skeleton cards while the cards load', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
    mock.current.on('GET', `${BOARD}/columns`, {
      status: 200,
      data: { columns: defaultColumns() },
    });
    mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
    const reply = deferred<MockReply>();
    mock.current.on('GET', CARDS, () => reply.promise);
    renderApp(BOARD);

    await screen.findByRole('heading', { level: 1, name: 'Board' });
    expect(screen.getAllByTestId('card-skeleton')).toHaveLength(8);
    expect(screen.queryByText('No cards')).toBeNull();
    reply.resolve({ status: 200, data: cardListFor(defaultColumns(), initialCards) });

    expect(await screen.findByRole('button', { name: /^SB-1 / })).toBeVisible();
    expect(screen.queryByTestId('card-skeleton')).toBeNull();
  });

  it('offers a retry when the cards cannot be loaded', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
    mock.current.on('GET', `${BOARD}/columns`, {
      status: 200,
      data: { columns: defaultColumns() },
    });
    mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
    mock.current.on('GET', CARDS, 'network-error', {
      status: 200,
      data: cardListFor(defaultColumns(), initialCards),
    });
    renderApp(BOARD);

    expect(await screen.findByText('Could not load the cards.')).toBeVisible();
    // The inline banner is enough: no toast on top of it.
    expect(screen.queryByText(/unable to reach/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: /^SB-1 / })).toBeVisible();
    expect(screen.queryByText('Could not load the cards.')).toBeNull();
  });

  it('explains COLUMN_NOT_EMPTY when deleting a column with cards', async () => {
    await renderBoard('MEMBER');
    mock.current.on('DELETE', `${BOARD}/columns/col-todo`, {
      status: 409,
      data: errorBody('COLUMN_NOT_EMPTY'),
    });

    await chooseMenuItem('Actions for column To Do', 'Delete');
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete column' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Move or delete the cards in this column first.',
    );
  });
});

describe('quick create', () => {
  it('adds cards with Enter and keeps the composer open for the next one', async () => {
    await renderBoard('MEMBER');
    const created = cardWith({
      id: 'new',
      number: 4,
      columnId: 'col-done',
      rank: 'h',
      title: 'Ship it',
    });
    mock.current.on('POST', CARDS, { status: 201, data: { card: created } });

    fireEvent.click(screen.getByRole('button', { name: 'Add a card to Done' }));
    const form = screen.getByRole('form', { name: 'Add a card to Done' });
    const input = within(form).getByLabelText('Card title');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Ship it ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(cardKeysIn('Done')).toEqual(['SB-4']));
    expect(mock.current.requestsTo('POST', CARDS)[0]?.data).toEqual({
      columnId: 'col-done',
      title: 'Ship it',
    });
    expect(input).toHaveValue('');
    expect(within(columnRegion('Done')).getByText('(1)')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('form', { name: 'Add a card to Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a card to Done' })).toHaveFocus();
  });

  it('explains that a created card is hidden by the active filter', async () => {
    await renderBoard('MEMBER');
    const created = cardWith({
      id: 'new',
      number: 4,
      columnId: 'col-todo',
      rank: 'w',
      title: 'Unrelated',
    });
    mock.current.on('POST', CARDS, { status: 201, data: { card: created } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter cards' }), {
      target: { value: 'login' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add a card to To Do' }));
    const form = screen.getByRole('form', { name: 'Add a card to To Do' });
    fireEvent.change(within(form).getByLabelText('Card title'), {
      target: { value: 'Unrelated' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add card' }));

    expect(await within(form).findByRole('status')).toHaveTextContent(
      'SB-4 was created, but it is hidden by the current filter.',
    );
    expect(cardKeysIn('To Do')).toEqual(['SB-1']);
    expect(within(columnRegion('To Do')).getByText('(3)')).toBeInTheDocument();
  });

  it('refreshes the board when the column was deleted elsewhere', async () => {
    await renderBoard('MEMBER');
    const remaining = defaultColumns().filter((column) => column.id !== 'col-done');
    mock.current.on('POST', CARDS, { status: 404, data: errorBody('COLUMN_NOT_FOUND') });
    mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: remaining } });
    mock.current.on('GET', CARDS, { status: 200, data: cardListFor(remaining, initialCards) });

    fireEvent.click(screen.getByRole('button', { name: 'Add a card to Done' }));
    const form = screen.getByRole('form', { name: 'Add a card to Done' });
    fireEvent.change(within(form).getByLabelText('Card title'), { target: { value: 'Late' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add card' }));

    // The composer disappears with its column, so the message is a toast.
    expect(
      await screen.findByText('This column no longer exists. The board has been refreshed.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Done' })).toBeNull());
  });

  it('validates the title and explains WIP_LIMIT_EXCEEDED', async () => {
    await renderBoard('MEMBER');
    mock.current.on('POST', CARDS, { status: 409, data: errorBody('WIP_LIMIT_EXCEEDED') });

    fireEvent.click(screen.getByRole('button', { name: 'Add a card to In Progress' }));
    const form = screen.getByRole('form', { name: 'Add a card to In Progress' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add card' }));

    expect(within(form).getByRole('alert')).toHaveTextContent('Card title is required');
    expect(mock.current.requestsTo('POST', CARDS)).toHaveLength(0);

    fireEvent.change(within(form).getByLabelText('Card title'), { target: { value: 'One more' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add card' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This column has reached its WIP limit.',
    );
    expect(cardKeysIn('In Progress')).toEqual(['SB-3']);
  });
});

describe('dragging cards', () => {
  let restoreLayout: (() => void) | undefined;
  afterEach(() => {
    restoreLayout?.();
    restoreLayout = undefined;
  });

  it('reorders a card within its column with the keyboard', async () => {
    const consoleError = vi.spyOn(console, 'error');
    await renderBoard('MEMBER');
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/t1/move`, () => reply.promise);

    await dragCard('SB-1', ['ArrowDown']);

    expect(cardKeysIn('To Do')).toEqual(['SB-2', 'SB-1']);
    expect(mock.current.requestsTo('PATCH', `${CARDS}/t1/move`)[0]?.data).toEqual({
      columnId: 'col-todo',
      afterId: 't2',
      beforeId: null,
    });
    reply.resolve({ status: 200, data: { card: { ...t1, rank: 'r' } } });
    await flush();

    expect(cardKeysIn('To Do')).toEqual(['SB-2', 'SB-1']);
    expect(mock.current.requestsTo('GET', CARDS)).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('moves a card to the next column with the keyboard', async () => {
    restoreLayout = stubBoardLayout();
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${CARDS}/t2/move`, {
      status: 200,
      data: { card: { ...t2, columnId: 'col-progress', rank: 'p' } },
    });

    await dragCard('SB-2', ['ArrowRight']);

    expect(cardKeysIn('To Do')).toEqual(['SB-1']);
    expect(cardKeysIn('In Progress')).toEqual(['SB-3', 'SB-2']);
    expect(mock.current.requestsTo('PATCH', `${CARDS}/t2/move`)[0]?.data).toEqual({
      columnId: 'col-progress',
      afterId: 'p1',
      beforeId: null,
    });
    await waitFor(() =>
      expect(within(columnRegion('In Progress')).getByText(/2 \/ 3/)).toBeInTheDocument(),
    );
  });

  it('moves the card back and shows a toast when the move is rejected', async () => {
    restoreLayout = stubBoardLayout();
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${CARDS}/t1/move`, {
      status: 409,
      data: errorBody('WIP_LIMIT_EXCEEDED'),
    });

    await dragCard('SB-1', ['ArrowRight']);

    expect(await screen.findByText('This column has reached its WIP limit.')).toBeInTheDocument();
    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
    expect(cardKeysIn('In Progress')).toEqual(['SB-3']);
  });

  it('keeps column dragging working next to the card lists', async () => {
    await renderBoard('MEMBER');
    mock.current.on('PATCH', `${BOARD}/columns/col-backlog/move`, {
      status: 200,
      data: {
        column: columnWith({ id: 'col-backlog', title: 'Backlog', rank: 'l', category: 'BACKLOG' }),
      },
    });

    const handle = screen.getByRole('button', { name: 'Drag column Backlog' });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
    await flush();
    fireEvent.keyDown(handle, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    await flush();
    fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
    await flush();

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'To Do',
      'Backlog',
      'In Progress',
      'Done',
    ]);
    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
  });
});

describe('filtering cards', () => {
  it('filters by text in the title or key and pauses dragging', async () => {
    await renderBoard('MEMBER');
    const filter = screen.getByRole('searchbox', { name: 'Filter cards' });

    fireEvent.change(filter, { target: { value: 'LOGIN' } });

    expect(cardKeysIn('To Do')).toEqual(['SB-1']);
    expect(cardKeysIn('In Progress')).toEqual([]);
    // Counters keep showing all cards of the column.
    expect(within(columnRegion('To Do')).getByText('(2)')).toBeInTheDocument();
    expect(within(columnRegion('In Progress')).getByText('No cards')).toBeInTheDocument();
    expect(tile('SB-1')).not.toHaveAttribute('data-rfd-drag-handle-draggable-id');
    expect(screen.getByText('Clear the filter to drag cards.')).toBeVisible();

    fireEvent.change(filter, { target: { value: 'sb-3' } });
    expect(cardKeysIn('In Progress')).toEqual(['SB-3']);

    fireEvent.change(filter, { target: { value: '' } });
    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
    expect(tile('SB-1')).toHaveAttribute('data-rfd-drag-handle-draggable-id', 't1');
    expect(mock.current.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('filters by the selected member avatars', async () => {
    await renderBoard('MEMBER');
    const stack = screen.getByRole('group', { name: 'Board members' });

    fireEvent.click(within(stack).getByRole('button', { name: 'Ola Nowak' }));

    expect(cardKeysIn('To Do')).toEqual(['SB-2']);
    expect(cardKeysIn('In Progress')).toEqual([]);

    fireEvent.click(within(stack).getByRole('button', { name: 'Jan Kowalski' }));
    expect(cardKeysIn('To Do')).toEqual(['SB-2']);

    fireEvent.click(within(stack).getByRole('button', { name: 'Ola Nowak' }));
    fireEvent.click(within(stack).getByRole('button', { name: 'Jan Kowalski' }));
    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
  });
});

describe('cards for a VIEWER', () => {
  it('shows the cards without controls that change them', async () => {
    await renderBoard('VIEWER');

    expect(cardKeysIn('To Do')).toEqual(['SB-1', 'SB-2']);
    expect(screen.queryByRole('button', { name: /^Add a card to/ })).toBeNull();
    for (const card of screen.getAllByRole('button', { name: /^SB-\d/ })) {
      expect(card).not.toHaveAttribute('data-rfd-drag-handle-draggable-id');
    }
    expect(screen.queryByText('Clear the filter to drag cards.')).toBeNull();
  });
});
