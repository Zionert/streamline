import type { AnalyticsResponse } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSocketFactory } from '@/lib/socket';
import { FakeSocket } from '@/test/fakeSocket';
import { columnWith, commentWith, defaultColumns } from '@/test/fixtures';
import { SCATTER_POINTS, analyticsWith, scatterPoint } from '@/test/flowFixtures';
import {
  ANALYTICS,
  BOARD,
  FLOW,
  FORECAST,
  analyticsShown,
  fixLogin,
  ok,
  renderFlowPage,
  type RenderFlowOptions,
} from '@/test/flowPage';
import { deferred, type MockReply } from '@/test/mockAdapter';
import { setupMockApi } from '@/test/renderApp';

import { CSV_BOM } from './flowCsv';
import { FLOW_REFRESH_DELAY_MS } from './flowRefresh';

const mock = setupMockApi();

let sockets: FakeSocket[] = [];

beforeEach(() => {
  sockets = [];
  setSocketFactory(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket.asSocket();
  });
});

/** `URL` statics replaced by a test (jsdom has none of them), restored after it. */
const urlStatics = new Map<string, PropertyDescriptor | undefined>();

function stubUrlStatic(name: 'createObjectURL' | 'revokeObjectURL', value: unknown) {
  if (!urlStatics.has(name)) {
    urlStatics.set(name, Object.getOwnPropertyDescriptor(URL, name));
  }
  Object.defineProperty(URL, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  vi.useRealTimers();
  for (const [name, descriptor] of urlStatics) {
    if (descriptor) {
      Object.defineProperty(URL, name, descriptor);
    } else {
      Reflect.deleteProperty(URL, name);
    }
  }
  urlStatics.clear();
});

function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was created');
  return socket;
}

/** Lets pending promises (acknowledgements, mocked requests) settle, with real timers. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

/** Analytics whose Little's law shows `Avg WIP <avgWip>`, to tell responses apart. */
function analyticsWithWip(avgWip: number): AnalyticsResponse {
  return analyticsWith({ littlesLaw: { ...analyticsWith().littlesLaw, avgWip } });
}

let router: Awaited<ReturnType<typeof renderFlowPage>>['router'];

/** Renders Flow, connects its socket and waits for the analytics and the room join. */
async function renderLiveFlow(options: RenderFlowOptions = {}): Promise<FakeSocket> {
  ({ router } = await renderFlowPage(mock, undefined, options));
  await analyticsShown();
  const socket = lastSocket();
  await act(async () => {
    socket.serverConnect();
    await Promise.resolve();
  });
  await settle();
  return socket;
}

const analyticsRequests = () => mock.current.requestsTo('GET', ANALYTICS).length;

/** Fakes the timers from now on (the debounce of the refresh). */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

/** Advances the fake clock and lets the requests started meanwhile reach the mock API. */
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

const movedCard = { ...fixLogin, columnId: 'col-progress', rank: 'm' };

describe('live refresh of the analytics', () => {
  it('reads the analytics again once, 2 s after a burst of card and column changes', async () => {
    const socket = await renderLiveFlow({
      analytics: [ok(analyticsWithWip(4.6)), ok(analyticsWithWip(7.7))],
    });
    expect(analyticsRequests()).toBe(1);
    fakeTimers();

    emit(socket, 'card:moved', { card: movedCard });
    await advance(1000);
    emit(socket, 'card:updated', { card: { ...movedCard, title: 'Fix the login' } });
    emit(socket, 'column:updated', {
      column: { ...defaultColumns()[1], title: 'Ready' },
    });
    await advance(FLOW_REFRESH_DELAY_MS - 1);
    expect(analyticsRequests()).toBe(1);
    await advance(1);
    expect(analyticsRequests()).toBe(2);

    vi.useRealTimers();
    await settle();
    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 7.7');
    // The same range is requested; the forecast is not run again.
    const [first, second] = mock.current.requestsTo('GET', ANALYTICS);
    expect(second?.params).toEqual(first?.params);
    expect(mock.current.requestsTo('GET', FORECAST)).toHaveLength(1);
  });

  it('does not postpone the refresh forever under a steady stream of changes', async () => {
    const socket = await renderLiveFlow();
    fakeTimers();

    for (let i = 0; i < 6; i++) {
      emit(socket, 'card:moved', { card: movedCard });
      await advance(FLOW_REFRESH_DELAY_MS - 500);
    }

    // Capped at twice the delay after the first change of the burst.
    expect(analyticsRequests()).toBe(3);
  });

  it('keeps the data on screen while it is read again', async () => {
    const pending = deferred<MockReply>();
    const socket = await renderLiveFlow({
      analytics: [ok(analyticsWithWip(4.6)), () => pending.promise],
    });
    fakeTimers();

    emit(socket, 'card:created', { card: { ...fixLogin, id: 'card-new', number: 30 } });
    await advance(FLOW_REFRESH_DELAY_MS);
    vi.useRealTimers();
    await settle();

    expect(screen.getByLabelText('Key figures')).toBeInTheDocument();
    expect(screen.queryByText('Loading flow analytics...')).toBeNull();
    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 4.6');
    expect(screen.getByText('Updating…')).toBeInTheDocument();

    pending.resolve(ok(analyticsWithWip(5.5)));
    await settle();

    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 5.5');
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('does not show "Updating…" while the analytics load for the first time', async () => {
    const first = deferred<MockReply>();
    const second = deferred<MockReply>();
    await renderFlowPage(mock, undefined, {
      analytics: [() => first.promise, () => second.promise],
    });
    const socket = lastSocket();
    await act(async () => {
      socket.serverConnect();
      await Promise.resolve();
    });
    await settle();
    fakeTimers();

    emit(socket, 'card:moved', { card: movedCard });
    await advance(FLOW_REFRESH_DELAY_MS);
    expect(analyticsRequests()).toBe(2);

    expect(screen.getByText('Loading flow analytics...')).toBeInTheDocument();
    expect(screen.queryByText('Updating…')).toBeNull();
    vi.useRealTimers();
    second.resolve(ok(analyticsWithWip(4.6)));
    await analyticsShown();
    first.resolve(ok(analyticsWithWip(1.1)));
    await settle();
    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 4.6');
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('drops a refresh that answers after a later one', async () => {
    const slow = deferred<MockReply>();
    const socket = await renderLiveFlow({
      analytics: [ok(analyticsWithWip(4.6)), () => slow.promise, ok(analyticsWithWip(9.9))],
    });
    fakeTimers();

    emit(socket, 'card:deleted', { cardId: fixLogin.id });
    await advance(FLOW_REFRESH_DELAY_MS);
    emit(socket, 'column:deleted', { columnId: 'col-backlog' });
    await advance(FLOW_REFRESH_DELAY_MS);
    expect(analyticsRequests()).toBe(3);
    vi.useRealTimers();
    await settle();
    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 9.9');

    slow.resolve(ok(analyticsWithWip(1.1)));
    await settle();

    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 9.9');
  });

  it('keeps the data when a refresh fails', async () => {
    const socket = await renderLiveFlow({
      analytics: [ok(analyticsWithWip(4.6)), { status: 500, data: {} }],
    });
    fakeTimers();

    emit(socket, 'column:created', {
      column: columnWith({ id: 'col-qa', rank: 'q' }),
    });
    await advance(FLOW_REFRESH_DELAY_MS);
    vi.useRealTimers();
    await settle();

    expect(analyticsRequests()).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 4.6');
  });

  it('ignores changes that do not affect the analytics', async () => {
    const socket = await renderLiveFlow();
    fakeTimers();

    emit(socket, 'comment:created', {
      comment: commentWith({ id: 'm1', cardId: fixLogin.id, createdAt: '2026-11-17T10:00:00Z' }),
    });
    emit(socket, 'member:removed', { userId: 'user-ann' });
    await advance(FLOW_REFRESH_DELAY_MS * 3);

    expect(analyticsRequests()).toBe(1);
  });

  it('reads the analytics again once after a reconnect', async () => {
    const socket = await renderLiveFlow();

    act(() => {
      socket.serverDisconnect();
    });
    fakeTimers();
    await act(async () => {
      socket.serverConnect();
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(FLOW_REFRESH_DELAY_MS);

    expect(analyticsRequests()).toBe(2);
    await advance(FLOW_REFRESH_DELAY_MS * 3);
    expect(analyticsRequests()).toBe(2);
  });

  it('drops a pending refresh when the page is left', async () => {
    const socket = await renderLiveFlow();
    fakeTimers();
    emit(socket, 'card:moved', { card: movedCard });

    await act(() => router.navigate('/boards'));
    await advance(FLOW_REFRESH_DELAY_MS * 2);

    expect(analyticsRequests()).toBe(1);
  });
});

describe('own changes made over Flow', () => {
  /** Opens SB-1 over Flow and waits for its details and the analytics behind. */
  async function openCard(analytics: AnalyticsResponse[]): Promise<HTMLElement> {
    await renderFlowPage(mock, `${FLOW}/cards/SB-1`, { analytics: analytics.map(ok) });
    return screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
  }

  function scatterTable(): HTMLElement {
    const chart = screen.getByRole('figure', { name: 'Cycle time' });
    const toggle = within(chart).getByRole('button', { name: 'View data' });
    if (toggle.getAttribute('aria-expanded') === 'false') {
      fireEvent.click(toggle);
    }
    return within(chart).getByRole('table');
  }

  it('reads the analytics again once after a card is deleted from its details', async () => {
    const dialog = await openCard([analyticsWith(), analyticsWith({}, SCATTER_POINTS.slice(1))]);
    mock.current.on('DELETE', `${BOARD}/cards/${fixLogin.id}`, { status: 204 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete card SB-1?' });
    expect(analyticsRequests()).toBe(1);
    fakeTimers();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete card' }));
    await advance(0);
    expect(mock.current.requestsTo('DELETE', `${BOARD}/cards/${fixLogin.id}`)).toHaveLength(1);
    await advance(FLOW_REFRESH_DELAY_MS - 1);
    expect(analyticsRequests()).toBe(1);
    await advance(1);
    expect(analyticsRequests()).toBe(2);
    await advance(FLOW_REFRESH_DELAY_MS * 3);
    expect(analyticsRequests()).toBe(2);

    vi.useRealTimers();
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(scatterTable()).queryByRole('link', { name: 'SB-1' })).toBeNull();
    expect(within(scatterTable()).getByRole('link', { name: 'SB-2' })).toBeInTheDocument();
  });

  it('reads the analytics again after a card is edited in its details', async () => {
    const renamed = [
      scatterPoint({ ...SCATTER_POINTS[0], cardKey: 'SB-1', title: 'Fix the login form' }),
      ...SCATTER_POINTS.slice(1),
    ];
    const dialog = await openCard([analyticsWith(), analyticsWith({}, renamed)]);
    mock.current.on('PATCH', `${BOARD}/cards/${fixLogin.id}`, {
      status: 200,
      data: { card: { ...fixLogin, title: 'Fix the login form' } },
    });
    fakeTimers();

    const title = within(dialog).getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Fix the login form' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await advance(0);
    expect(mock.current.requestsTo('PATCH', `${BOARD}/cards/${fixLogin.id}`)).toHaveLength(1);
    await advance(FLOW_REFRESH_DELAY_MS);
    expect(analyticsRequests()).toBe(2);

    vi.useRealTimers();
    await settle();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(scatterTable()).getByRole('row', { name: /SB-1/ })).toHaveTextContent(
      'Fix the login form',
    );
  });
});

describe('CSV export', () => {
  it('downloads the analytics shown as a CSV file', async () => {
    await renderFlowPage(mock);
    await analyticsShown();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:flow-csv');
    const revokeObjectURL = vi.fn<(url: string) => void>();
    stubUrlStatic('createObjectURL', createObjectURL);
    stubUrlStatic('revokeObjectURL', revokeObjectURL);
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(clicks).toEqual([
      { href: 'blob:flow-csv', download: 'SB-flow-2026-10-19_2026-11-17.csv' },
    ]);
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error('No file was created');
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith(`${CSV_BOM}Cards completed;2026-10-19;2026-11-17;UTC\r\n`)).toBe(true);
    expect(text).toContain('SB-1;Fix login;2026-10-22 13:05;9,4;4,1\r\n');
    expect(text).toContain('\r\n\r\nDaily throughput\r\nDate;Completed\r\n');
    // The temporary link is gone and its URL is released.
    expect(document.querySelector('a[download]')).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:flow-csv'));
  });

  it('is disabled while the analytics load', async () => {
    const pending = deferred<MockReply>();
    await renderFlowPage(mock, undefined, { analytics: [() => pending.promise] });

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();

    pending.resolve(ok(analyticsWith()));
    await analyticsShown();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
});
