import type { AgingResponse, CardAgingItem } from '@streamline/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSocketFactory } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import { FakeSocket } from '@/test/fakeSocket';
import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from '@/test/fixtures';
import { deferred, type MockReply, type MockResponder } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

import { AGING_REFRESH_DELAY_MS, AGING_TICK_MS } from './useCardAging';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const CARDS = `${BOARD}/cards`;
const AGING = `${BOARD}/analytics/aging`;

const p1 = cardWith({ id: 'p1', number: 1, columnId: 'col-progress', rank: 'b', title: 'Old' });
const p2 = cardWith({ id: 'p2', number: 2, columnId: 'col-progress', rank: 'd', title: 'New' });
const t1 = cardWith({ id: 't1', number: 3, columnId: 'col-todo', rank: 'b', title: 'Waiting' });

const DAY_MS = 86_400_000;

/** A card in progress for `ageDays` days as of now (the badge counts the age from its start). */
function item(cardId: string, ageDays: number, isAging = true): CardAgingItem {
  const cycleStartedAt = new Date(Date.now() - ageDays * DAY_MS).toISOString();
  return { cardId, cycleStartedAt, ageDays, isAging };
}

function aging(...items: CardAgingItem[]): MockReply {
  const body: AgingResponse = {
    generatedAt: '2026-11-17T12:00:00.000Z',
    thresholdDays: 5,
    items,
  };
  return { status: 200, data: body };
}

let sockets: FakeSocket[] = [];

beforeEach(() => {
  sockets = [];
  setSocketFactory(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket.asSocket();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was created');
  return socket;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

function mockBoard(boardId: string, name: string, cards = [p1, p2, t1]) {
  const base = `/boards/${boardId}`;
  const columns = defaultColumns(boardId);
  mock.current.on('GET', base, { status: 200, data: { board: boardWith({ id: boardId, name }) } });
  mock.current.on('GET', `${base}/columns`, { status: 200, data: { columns } });
  mock.current.on('GET', `${base}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', `${base}/cards`, { status: 200, data: cardListFor(columns, cards) });
  mock.current.on('GET', `${base}/labels`, { status: 200, data: { labels: [] } });
}

async function renderBoard(...agingReplies: MockResponder[]) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard('board-1', 'Sprint board');
  mock.current.on('GET', AGING, ...agingReplies);
  const result = renderApp(BOARD);
  await screen.findByRole('heading', { level: 1, name: 'Sprint board' });
  await screen.findByText('SB-1');
  await settle();
  return result;
}

/** Connects the board's socket and waits for the join. */
async function connect(): Promise<FakeSocket> {
  const socket = lastSocket();
  await act(async () => {
    socket.serverConnect();
    await Promise.resolve();
  });
  await settle();
  return socket;
}

function tile(cardKey: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-card-key="${cardKey}"]`);
  if (!found) throw new Error(`No tile of ${cardKey}`);
  return found;
}

function badgeOf(cardKey: string): string | null {
  return within(tile(cardKey)).queryByTestId('card-aging')?.textContent ?? null;
}

const agingRequests = () => mock.current.requestsTo('GET', AGING).length;

/** Fakes the timers from now on (the debounce of the refresh). */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

function emit(socket: FakeSocket, event: string, payload: Record<string, unknown>) {
  act(() => {
    socket.serverEmit(event, { boardId: 'board-1', actorId: 'user-ann', ...payload });
  });
}

describe('aging badge on the board', () => {
  it('marks the aging cards of IN_PROGRESS columns', async () => {
    // t1 is still in progress for the server, but To Do here: no badge.
    await renderBoard(aging(item('p1', 9.6), item('p2', 1, false), item('t1', 12)));

    expect(agingRequests()).toBe(1);
    expect(badgeOf('SB-1')).toBe('Aging · 9d');
    expect(within(tile('SB-1')).getByTestId('card-aging')).toHaveAttribute(
      'title',
      'In progress for 9 days',
    );
    expect(tile('SB-1')).toHaveAccessibleName(/, aging: in progress for 9 days$/);
    expect(badgeOf('SB-2')).toBeNull();
    expect(badgeOf('SB-3')).toBeNull();
  });

  it('counts the age from the start of the cycle and keeps it growing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'));
    // The server's age is a snapshot; the start of the cycle is what counts.
    const started = new Date(Date.now() - (10 * DAY_MS - 30_000)).toISOString();
    await renderBoard(aging({ cardId: 'p1', cycleStartedAt: started, ageDays: 3, isAging: true }));
    expect(badgeOf('SB-1')).toBe('Aging · 9d');

    act(() => {
      vi.advanceTimersByTime(AGING_TICK_MS);
    });

    expect(badgeOf('SB-1')).toBe('Aging · 10d');
    expect(agingRequests()).toBe(1);
  });

  it('shows the board without badges when the ages cannot be read', async () => {
    await renderBoard({ status: 500, data: {} });

    expect(badgeOf('SB-1')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the badge at once when the card is moved out of progress here', async () => {
    await renderBoard(aging(item('p1', 9)), aging());
    const reply = deferred<MockReply>();
    mock.current.on('PATCH', `${CARDS}/p1/move`, () => reply.promise);
    expect(badgeOf('SB-1')).toBe('Aging · 9d');

    act(() => {
      void useBoardStore.getState().moveCard('p1', 'col-done', 0);
    });

    // Before the server has even answered.
    expect(badgeOf('SB-1')).toBeNull();
    expect(agingRequests()).toBe(1);

    fakeTimers();
    reply.resolve({ status: 200, data: { card: { ...p1, columnId: 'col-done', rank: 'b' } } });
    await advance(0);
    await advance(AGING_REFRESH_DELAY_MS - 1);
    expect(agingRequests()).toBe(1);
    await advance(1);
    expect(agingRequests()).toBe(2);
  });

  it('hides the badge at once when someone else moves the card out of progress', async () => {
    await renderBoard(aging(item('p1', 9)), aging());
    const socket = await connect();
    expect(badgeOf('SB-1')).toBe('Aging · 9d');

    emit(socket, 'card:moved', { card: { ...p1, columnId: 'col-done', rank: 'b' } });

    expect(badgeOf('SB-1')).toBeNull();
  });

  it('hides the badges when the column stops being an IN_PROGRESS column', async () => {
    await renderBoard(aging(item('p1', 9)));
    const socket = await connect();
    const [, , progress] = defaultColumns();
    if (!progress) throw new Error('Expected the In Progress column');

    emit(socket, 'column:updated', { column: { ...progress, category: 'TODO' } });

    expect(badgeOf('SB-1')).toBeNull();
  });

  it('reads the ages again once, debounced, after remote changes', async () => {
    await renderBoard(aging(item('p1', 9)), aging(item('p1', 9), item('p2', 7)));
    const socket = await connect();
    fakeTimers();

    emit(socket, 'card:updated', { card: { ...p2, title: 'Newer' } });
    await advance(500);
    emit(socket, 'card:created', {
      card: cardWith({ id: 'p9', number: 9, columnId: 'col-progress', rank: 'x' }),
    });
    await advance(AGING_REFRESH_DELAY_MS - 1);
    expect(agingRequests()).toBe(1);
    await advance(1);
    expect(agingRequests()).toBe(2);

    expect(badgeOf('SB-2')).toBe('Aging · 7d');
    expect(badgeOf('SB-1')).toBe('Aging · 9d');
  });

  it('does not read the ages again after an own edit of a card', async () => {
    await renderBoard(aging(item('p1', 9)));
    mock.current.on('PATCH', `${CARDS}/p2`, {
      status: 200,
      data: { card: { ...p2, title: 'Renamed' } },
    });
    fakeTimers();

    await act(async () => {
      await useBoardStore.getState().updateCard('p2', { title: 'Renamed' });
    });
    await advance(AGING_REFRESH_DELAY_MS * 3);

    expect(mock.current.requestsTo('PATCH', `${CARDS}/p2`)).toHaveLength(1);
    expect(agingRequests()).toBe(1);
  });

  it('does not read the ages again for unrelated changes', async () => {
    await renderBoard(aging(item('p1', 9)));
    const socket = await connect();
    fakeTimers();

    emit(socket, 'member:removed', { userId: 'user-ann' });
    emit(socket, 'label:deleted', { labelId: 'l1' });
    await advance(AGING_REFRESH_DELAY_MS * 3);

    expect(agingRequests()).toBe(1);
  });

  it('drops ages that arrive after newer ones', async () => {
    const slow = deferred<MockReply>();
    await renderBoard(aging(item('p1', 9)), () => slow.promise, aging(item('p1', 10)));
    const socket = await connect();
    fakeTimers();

    emit(socket, 'card:deleted', { cardId: 't1' });
    await advance(AGING_REFRESH_DELAY_MS);
    emit(socket, 'card:moved', { card: { ...p2, rank: 'a' } });
    await advance(AGING_REFRESH_DELAY_MS);
    expect(agingRequests()).toBe(3);
    expect(badgeOf('SB-1')).toBe('Aging · 10d');

    slow.resolve(aging(item('p1', 2), item('p2', 30)));
    await advance(0);

    expect(badgeOf('SB-1')).toBe('Aging · 10d');
    expect(badgeOf('SB-2')).toBeNull();
  });

  it('starts over on another board and ignores the ages of the previous one', async () => {
    const late = deferred<MockReply>();
    const { router } = await renderBoard(() => late.promise);
    const other = cardWith({
      id: 'o1',
      number: 1,
      boardId: 'board-2',
      key: 'OT-1',
      columnId: 'col-progress',
      rank: 'b',
    });
    mockBoard('board-2', 'Other board', [other]);
    const otherAging = deferred<MockReply>();
    mock.current.on('GET', '/boards/board-2/analytics/aging', () => otherAging.promise);

    await act(() => router.navigate('/boards/board-2'));
    await screen.findByRole('heading', { level: 1, name: 'Other board' });
    await screen.findByText('OT-1');

    // board-1's answer names card ids that happen to be shown now: ignored.
    late.resolve(aging(item('o1', 40)));
    await settle();
    expect(badgeOf('OT-1')).toBeNull();

    otherAging.resolve(aging(item('o1', 3)));
    await waitFor(() => expect(badgeOf('OT-1')).toBe('Aging · 3d'));
  });
});
