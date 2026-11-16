import type { BoardRole, Comment } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import {
  boardWith,
  cardListFor,
  cardWith,
  commentWith,
  defaultColumns,
  memberWith,
  sessionWith,
  testUser,
} from '@/test/fixtures';
import { errorBody } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const COMMENTS = `${CARDS}/t1/comments`;

const t1 = cardWith({ id: 't1', number: 1, columnId: 'col-todo', rank: 'd', title: 'Fix login' });
const ola = { id: 'user-ola', name: 'Ola Nowak' };

const mine = commentWith({
  id: 'c1',
  cardId: 't1',
  createdAt: '2026-11-11T09:00:00.000Z',
  body: 'My first thought',
});
const olas = commentWith({
  id: 'c2',
  cardId: 't1',
  createdAt: '2026-11-11T09:30:00.000Z',
  author: ola,
  body: 'Ola replies',
  editedAt: '2026-11-11T09:40:00.000Z',
});
const orphan = commentWith({
  id: 'c3',
  cardId: 't1',
  createdAt: '2026-11-11T09:45:00.000Z',
  author: null,
  body: 'From a deleted account',
});

async function renderCard(
  role: BoardRole = 'MEMBER',
  comments: Comment[] = [mine, olas, orphan],
  nextCursor: string | null = null,
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith({ role }) } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns: defaultColumns() } });
  mock.current.on('GET', `${BOARD}/members`, {
    status: 200,
    data: { members: [memberWith({ role })] },
  });
  mock.current.on('GET', CARDS, { status: 200, data: cardListFor(defaultColumns(), [t1]) });
  mock.current.on('GET', `${BOARD}/labels`, { status: 200, data: { labels: [] } });
  mock.current.on('GET', COMMENTS, { status: 200, data: { comments, nextCursor } });
  renderApp(`${BOARD}/cards/SB-1`);
  const dialog = await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
  return dialog;
}

const commentsList = () => screen.findByRole('list', { name: 'Comments' });
const commentBy = async (name: string) =>
  within(await commentsList()).getAllByRole('listitem', { name: `Comment by ${name}` });

describe('comments', () => {
  it('lists the comments oldest first with author, time and the edited marker', async () => {
    await renderCard();

    const list = await commentsList();
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      `Comment by ${testUser.name}`,
      'Comment by Ola Nowak',
      'Comment by Deleted user',
    ]);
    expect(items[1]).toHaveTextContent('Ola replies');
    expect(items[1]).toHaveTextContent('(edited)');
    expect(items[0]).not.toHaveTextContent('(edited)');
    expect(within(items[1] as HTMLElement).getByRole('img', { name: 'Ola Nowak' })).toBeVisible();
    expect(
      within(items[2] as HTMLElement).getByRole('img', { name: 'Deleted user' }),
    ).toBeVisible();
    expect(within(items[0] as HTMLElement).getByText(/11 Nov 2026|ago|yesterday/)).toHaveAttribute(
      'datetime',
      mine.createdAt,
    );
  });

  it('posts a comment with Ctrl+Enter and shows it once when the event arrives as well', async () => {
    const dialog = await renderCard('MEMBER', [mine]);
    const created = commentWith({
      id: 'c9',
      cardId: 't1',
      createdAt: '2026-11-11T11:00:00.000Z',
      body: 'Looks good',
    });
    mock.current.on('POST', COMMENTS, { status: 201, data: { comment: created } });

    const input = within(dialog).getByRole('textbox', { name: 'New comment' });
    const send = within(dialog).getByRole('button', { name: 'Comment' });
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(send).toBeDisabled();

    fireEvent.change(input, { target: { value: '  Looks good ' } });
    expect(send).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    expect(await within(await commentsList()).findByText('Looks good')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(mock.current.requestsTo('POST', COMMENTS)[0]?.data).toEqual({ body: 'Looks good' });

    act(() => {
      useBoardStore.getState().applyBoardEvent({
        name: 'comment:created',
        payload: { boardId: 'board-1', actorId: testUser.id, comment: created },
      });
    });
    expect(within(await commentsList()).getAllByText('Looks good')).toHaveLength(1);
  });

  it('disables sending a comment over the length limit', async () => {
    const dialog = await renderCard('MEMBER', []);

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'New comment' }), {
      target: { value: 'x'.repeat(5001) },
    });

    expect(within(dialog).getByRole('button', { name: 'Comment' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at most 5000 characters');
  });

  it('edits an own comment in place', async () => {
    await renderCard();
    const edited = { ...mine, body: 'Second thought', editedAt: '2026-11-11T12:00:00.000Z' };
    mock.current.on('PATCH', `${COMMENTS}/c1`, { status: 200, data: { comment: edited } });

    const [item] = await commentBy(testUser.name);
    fireEvent.click(within(item as HTMLElement).getByRole('button', { name: /^Edit comment/ }));
    const editor = within(item as HTMLElement).getByRole('textbox', { name: 'Edit comment' });
    fireEvent.change(editor, { target: { value: 'Second thought' } });
    fireEvent.click(within(item as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(item).toHaveTextContent('Second thought'));
    await waitFor(() => expect(item).toHaveTextContent('(edited)'));
    expect(mock.current.requestsTo('PATCH', `${COMMENTS}/c1`)[0]?.data).toEqual({
      body: 'Second thought',
    });
  });

  it('restores an own comment when saving the edit fails', async () => {
    await renderCard();
    mock.current.on('PATCH', `${COMMENTS}/c1`, { status: 503, data: errorBody('BOARD_BUSY') });

    const [item] = await commentBy(testUser.name);
    fireEvent.click(within(item as HTMLElement).getByRole('button', { name: /^Edit comment/ }));
    fireEvent.change(within(item as HTMLElement).getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Lost change' },
    });
    fireEvent.click(within(item as HTMLElement).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/board is busy/)).toBeInTheDocument();
    await waitFor(() => expect(item).toHaveTextContent('My first thought'));
  });

  it('cannot edit or delete comments of others as a member', async () => {
    await renderCard('MEMBER');

    const [olaItem] = await commentBy('Ola Nowak');
    const [orphanItem] = await commentBy('Deleted user');
    const [ownItem] = await commentBy(testUser.name);

    expect(within(olaItem as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(orphanItem as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(ownItem as HTMLElement).getByRole('button', { name: /^Edit/ })).toBeVisible();
    expect(within(ownItem as HTMLElement).getByRole('button', { name: /^Delete/ })).toBeVisible();
  });

  it('lets an admin delete any comment after a confirmation, but edit only their own', async () => {
    await renderCard('ADMIN');
    mock.current.on('DELETE', `${COMMENTS}/c2`, { status: 204 });

    const [olaItem] = await commentBy('Ola Nowak');
    expect(within(olaItem as HTMLElement).queryByRole('button', { name: /^Edit/ })).toBeNull();
    fireEvent.click(
      within(olaItem as HTMLElement).getByRole('button', { name: 'Delete comment by Ola Nowak' }),
    );
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete comment?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete comment' }));

    await waitFor(() => expect(screen.queryByText('Ola replies')).toBeNull());
    expect(mock.current.requestsTo('DELETE', `${COMMENTS}/c2`)).toHaveLength(1);
  });

  it('shows no composer and no actions to a viewer', async () => {
    const dialog = await renderCard('VIEWER');

    await commentsList();
    expect(within(dialog).queryByRole('textbox', { name: 'New comment' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /comment by/i })).toBeNull();
  });

  it('loads more comments page by page', async () => {
    const later = commentWith({ id: 'c4', cardId: 't1', createdAt: '2026-11-11T10:00:00.000Z' });
    const dialog = await renderCard('MEMBER', [mine], 'cursor-1');
    mock.current.on('GET', COMMENTS, (config) => {
      const params = config.params as { cursor?: string } | undefined;
      return params?.cursor === 'cursor-1'
        ? { status: 200, data: { comments: [later], nextCursor: null } }
        : { status: 200, data: { comments: [mine], nextCursor: 'cursor-1' } };
    });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Load more comments' }));

    expect(await within(await commentsList()).findByText(later.body)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Load more comments' })).toBeNull();
    expect(within(await commentsList()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('applies live comment events of the open card', async () => {
    await renderCard('MEMBER', [mine, olas]);
    await commentsList();

    act(() => {
      const store = useBoardStore.getState();
      store.applyBoardEvent({
        name: 'comment:updated',
        payload: {
          boardId: 'board-1',
          actorId: ola.id,
          comment: { ...olas, body: 'Ola changed her mind', updatedAt: '2026-11-11T12:00:00.000Z' },
        },
      });
      store.applyBoardEvent({
        name: 'comment:deleted',
        payload: { boardId: 'board-1', actorId: testUser.id, cardId: 't1', commentId: 'c1' },
      });
    });

    expect(await screen.findByText('Ola changed her mind')).toBeInTheDocument();
    expect(screen.queryByText('My first thought')).toBeNull();
  });
});
