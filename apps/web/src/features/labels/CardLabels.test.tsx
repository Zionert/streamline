import type { BoardRole, Card, Label } from '@streamline/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  labelWith,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { deferred, errorBody, type MockReply } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const LABELS = `${BOARD}/labels`;

const bug = labelWith({ id: 'bug', name: 'Bug', color: 'RED' });
const ui = labelWith({ id: 'ui', name: 'UI', color: 'BLUE' });
const t1 = cardWith({
  id: 't1',
  number: 1,
  columnId: 'col-todo',
  rank: 'd',
  title: 'Fix login',
  labelIds: ['bug'],
});
const t2 = cardWith({ id: 't2', number: 2, columnId: 'col-todo', rank: 'k', title: 'Write docs' });
const p1 = cardWith({
  id: 'p1',
  number: 3,
  columnId: 'col-progress',
  rank: 'h',
  title: 'Deploy',
  labelIds: ['ui'],
  assigneeId: 'user-1',
});

async function renderBoard(
  role: BoardRole = 'MEMBER',
  path = BOARD,
  { labels = [bug, ui], cards = [t1, t2, p1] }: { labels?: Label[]; cards?: Card[] } = {},
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role })] },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), cards) });
  mock.current.on('GET', LABELS, { status: 200, data: { labels } });
  for (const card of cards) {
    mock.current.on('GET', `${CARDS}/${card.id}/comments`, {
      status: 200,
      data: { comments: [], nextCursor: null },
    });
  }
  const result = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Sprint board', hidden: true });
  return result;
}

const openCard = () => screen.findByRole('dialog', { name: /^SB-1 Fix login/ });

async function openPicker() {
  const dialog = await openCard();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Edit labels' }));
  return screen.findByRole('list', { name: 'Board labels' });
}

const labelIdsOf = (cardId: string) =>
  Object.values(useBoardStore.getState().cardsByColumn)
    .flat()
    .find((card) => card.id === cardId)?.labelIds;

describe('labels on card tiles', () => {
  it('shows the labels of a card as a coloured dot and the name', async () => {
    await renderBoard();

    const tile = await screen.findByRole('button', { name: /^SB-1 Fix login.*labels Bug$/ });
    const label = within(tile).getByTestId('card-label');
    expect(label).toHaveTextContent('Bug');
    expect(within(label).getByText('Bug')).toHaveClass('truncate');
    const dot = label.querySelector('[data-label-color]');
    expect(dot).toHaveAttribute('data-label-color', 'RED');
    expect(dot?.getAttribute('style')).toContain('var(--label-red-dot)');
    expect(
      within(screen.getByRole('button', { name: /^SB-2 / })).queryByTestId('card-labels'),
    ).toBeNull();
  });
});

describe('label picker', () => {
  it('lists the labels of the card in the details', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);

    const dialog = await openCard();
    const list = within(dialog).getByRole('list', { name: 'Labels' });
    expect(within(list).getByText('Bug')).toBeInTheDocument();
    expect(within(list).queryByText('UI')).toBeNull();
  });

  it('toggles labels on the card optimistically', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const reply = deferred<MockReply>();
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, () => reply.promise);
    mock.current.on('DELETE', `${CARDS}/t1/labels/bug`, {
      status: 200,
      data: { card: { ...t1, labelIds: [] } },
    });

    const picker = await openPicker();
    const uiBox = within(picker).getByRole('checkbox', { name: 'UI' });
    expect(within(picker).getByRole('checkbox', { name: 'Bug' })).toBeChecked();
    expect(uiBox).not.toBeChecked();

    fireEvent.click(uiBox);
    await waitFor(() => expect(uiBox).toBeChecked());
    expect(labelIdsOf('t1')).toEqual(['bug', 'ui']);

    reply.resolve({ status: 200, data: { card: { ...t1, labelIds: ['bug', 'ui'] } } });
    await waitFor(() =>
      expect(mock.current.requestsTo('PUT', `${CARDS}/t1/labels/ui`)).toHaveLength(1),
    );

    fireEvent.click(within(picker).getByRole('checkbox', { name: 'Bug' }));
    await waitFor(() => expect(labelIdsOf('t1')).toEqual([]));
  });

  it('rolls a failed toggle back with a message', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('PUT', `${CARDS}/t1/labels/ui`, {
      status: 409,
      data: errorBody('CARD_LABEL_LIMIT_REACHED'),
    });

    const picker = await openPicker();
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'UI' }));

    expect(await screen.findByText(/card can have at most 10 labels/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(picker).getByRole('checkbox', { name: 'UI' })).not.toBeChecked(),
    );
    expect(labelIdsOf('t1')).toEqual(['bug']);
  });

  it('filters the labels by name', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);

    const picker = await openPicker();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search labels' }), {
      target: { value: 'u' },
    });

    expect(within(picker).getByRole('checkbox', { name: 'Bug' })).toBeInTheDocument();
    expect(within(picker).getByRole('checkbox', { name: 'UI' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search labels' }), {
      target: { value: 'bu' },
    });
    expect(within(picker).queryByRole('checkbox', { name: 'UI' })).toBeNull();
  });

  it('creates a label with a name and a colour', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const docs = labelWith({ id: 'docs', name: 'Docs', color: 'PURPLE' });
    mock.current.on('POST', LABELS, { status: 201, data: { label: docs } });

    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Create a label' }));
    const form = await screen.findByRole('form', { name: 'Create a label' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: '  Docs ' } });
    fireEvent.click(within(form).getByRole('radio', { name: 'Purple' }));
    expect(within(form).getByRole('radio', { name: 'Purple' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Create' }));

    const picker = await screen.findByRole('list', { name: 'Board labels' });
    expect(within(picker).getByRole('checkbox', { name: 'Docs' })).toBeInTheDocument();
    expect(mock.current.requestsTo('POST', LABELS)[0]?.data).toEqual({
      name: 'Docs',
      color: 'PURPLE',
    });
  });

  it('picks the colour with the keyboard (one tab stop, arrow keys move)', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);

    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Create a label' }));
    const form = await screen.findByRole('form', { name: 'Create a label' });
    const palette = within(form).getByRole('radiogroup', { name: 'Colour' });
    const radio = (name: string) => within(palette).getByRole('radio', { name });
    expect(radio('Green')).toHaveAttribute('tabindex', '0');
    expect(radio('Yellow')).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(radio('Green'), { key: 'ArrowRight' });
    expect(radio('Yellow')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Yellow')).toHaveFocus();
    expect(radio('Green')).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(radio('Yellow'), { key: 'ArrowLeft' });
    fireEvent.keyDown(radio('Green'), { key: 'ArrowLeft' });
    // Wraps around to the last colour.
    expect(radio('Gray')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Gray')).toHaveFocus();

    fireEvent.keyDown(radio('Gray'), { key: 'Home' });
    expect(radio('Green')).toHaveFocus();
    fireEvent.keyDown(radio('Green'), { key: 'End' });
    expect(radio('Gray')).toHaveAttribute('aria-checked', 'true');
  });

  it('explains a duplicate name and keeps the form open', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('POST', LABELS, { status: 409, data: errorBody('LABEL_NAME_TAKEN') });

    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Create a label' }));
    const form = await screen.findByRole('form', { name: 'Create a label' });
    fireEvent.click(within(form).getByRole('button', { name: 'Create' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Label name is required');

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'bug' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create' }));

    expect(await within(form).findByText(/label with this name already exists/)).toBeVisible();
  });

  it('renames a label, sending only the changed field', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    const renamed = { ...ui, name: 'Frontend', updatedAt: '2026-11-12T10:00:00.000Z' };
    mock.current.on('PATCH', `${LABELS}/ui`, { status: 200, data: { label: renamed } });

    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Edit label UI' }));
    const form = await screen.findByRole('form', { name: 'Edit label UI' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Frontend' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    const picker = await screen.findByRole('list', { name: 'Board labels' });
    expect(within(picker).getByRole('checkbox', { name: 'Frontend' })).toBeInTheDocument();
    expect(mock.current.requestsTo('PATCH', `${LABELS}/ui`)[0]?.data).toEqual({ name: 'Frontend' });
  });

  it('deletes a label after a confirmation explaining it leaves all cards', async () => {
    await renderBoard('MEMBER', `${BOARD}/cards/SB-1`);
    mock.current.on('DELETE', `${LABELS}/bug`, { status: 204 });

    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Edit label Bug' }));
    const form = await screen.findByRole('form', { name: 'Edit label Bug' });
    fireEvent.click(within(form).getByRole('button', { name: 'Delete label' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Delete label "Bug"?' });
    expect(confirm).toHaveTextContent('removed from all cards');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete label' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(useBoardStore.getState().labels).toEqual([ui]);
    expect(labelIdsOf('t1')).toEqual([]);
    expect(within(await openCard()).getByText('No labels')).toBeInTheDocument();
  });

  it('is read-only without card:write', async () => {
    await renderBoard('VIEWER', `${BOARD}/cards/SB-1`);

    const dialog = await openCard();

    expect(within(dialog).getByRole('list', { name: 'Labels' })).toHaveTextContent('Bug');
    expect(within(dialog).queryByRole('button', { name: 'Edit labels' })).toBeNull();
  });
});

describe('label filter', () => {
  it('combines labels (any of them) with the text and member filters', async () => {
    await renderBoard();
    await screen.findByRole('button', { name: /^SB-1 / });

    fireEvent.click(screen.getByRole('button', { name: 'Filter by label' }));
    const list = await screen.findByRole('list', { name: 'Filter by label' });
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Bug' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /^SB-3 / })).toBeNull());
    expect(screen.getByRole('button', { name: /^SB-1 / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^SB-2 / })).toBeNull();

    // OR within labels.
    fireEvent.click(within(list).getByRole('checkbox', { name: 'UI' }));
    expect(await screen.findByRole('button', { name: /^SB-3 / })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter by label, 2 selected' })).toBeInTheDocument();

    // AND with the text filter.
    fireEvent.keyDown(list, { key: 'Escape' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter cards' }), {
      target: { value: 'deploy' },
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^SB-1 / })).toBeNull());
    expect(screen.getByRole('button', { name: /^SB-3 / })).toBeInTheDocument();
    // Counters keep showing every card.
    expect(screen.getByLabelText('2 cards')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('button', { name: /^SB-2 / })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter cards' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Filter by label' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('stops filtering by a label deleted elsewhere', async () => {
    await renderBoard();
    await screen.findByRole('button', { name: /^SB-1 / });
    fireEvent.click(screen.getByRole('button', { name: 'Filter by label' }));
    const list = await screen.findByRole('list', { name: 'Filter by label' });
    fireEvent.click(within(list).getByRole('checkbox', { name: 'UI' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^SB-1 / })).toBeNull());

    useBoardStore.getState().applyBoardEvent({
      name: 'label:deleted',
      payload: { boardId: 'board-1', actorId: 'user-2', labelId: 'ui' },
    });

    expect(await screen.findByRole('button', { name: /^SB-1 / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
