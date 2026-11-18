import { addDays } from '@streamline/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';
import { activityWith, sessionWith } from '@/test/fixtures';
import { analyticsWith } from '@/test/flowFixtures';
import {
  ANALYTICS,
  BOARD,
  FLOW,
  analyticsShown,
  mockFlowBoard,
  ok,
  renderFlowPage,
} from '@/test/flowPage';
import { renderApp, setupMockApi } from '@/test/renderApp';

import { browserTimeZone } from './flowFormat';
import { RANGE_ERRORS, localToday } from './flowRange';

const mock = setupMockApi();

/** Noon UTC: the same calendar day in almost every time zone. */
const NOW = new Date('2026-11-18T12:00:00.000Z');
let today = '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  today = localToday(browserTimeZone());
});

afterEach(() => {
  vi.useRealTimers();
});

const renderFlow = (path = FLOW) => renderFlowPage(mock, path);

/** Query parameters of the latest analytics request. */
function lastAnalyticsParams(): unknown {
  return mock.current.requestsTo('GET', ANALYTICS).at(-1)?.params;
}

function rangeButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Date range: / });
}

async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(rangeButton());
  return screen.findByRole('dialog');
}

function kpiCaption(): string | null {
  const [completed] = screen.getAllByTestId('kpi-tile');
  return completed?.querySelectorAll('dd')[1]?.textContent ?? null;
}

describe('date range presets', () => {
  it('switches presets: the address and the requested dates follow', async () => {
    const { router } = await renderFlow();
    await analyticsShown();
    expect(lastAnalyticsParams()).toEqual({
      from: addDays(today, -29),
      to: today,
      timeZone: browserTimeZone(),
    });

    let picker = await openPicker();
    expect(within(picker).getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(picker).getByRole('button', { name: 'Last 14 days' }));

    await waitFor(() => expect(router.state.location.search).toBe('?range=14d'));
    await waitFor(() =>
      expect(lastAnalyticsParams()).toEqual({
        from: addDays(today, -13),
        to: today,
        timeZone: browserTimeZone(),
      }),
    );
    await analyticsShown();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rangeButton()).toHaveTextContent('Last 14 days');
    expect(kpiCaption()).toBe('last 14 days');

    picker = await openPicker();
    fireEvent.click(within(picker).getByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => expect(router.state.location.search).toBe('?range=90d'));
    await waitFor(() =>
      expect(lastAnalyticsParams()).toMatchObject({ from: addDays(today, -89), to: today }),
    );

    // The default range has no query.
    picker = await openPicker();
    fireEvent.click(within(picker).getByRole('button', { name: 'Last 30 days' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.pathname).toBe(FLOW);
  });

  it('keeps a preset from the address on reload', async () => {
    await renderFlow(`${FLOW}?range=90d`);
    await analyticsShown();

    expect(rangeButton()).toHaveTextContent('Last 90 days');
    expect(mock.current.requestsTo('GET', ANALYTICS)).toHaveLength(1);
    expect(lastAnalyticsParams()).toMatchObject({ from: addDays(today, -89), to: today });
    expect(kpiCaption()).toBe('last 90 days');
  });

  it.each([
    '?range=7d',
    '?range=30d',
    '?from=2026-10-01',
    '?from=2026-10-15&to=2026-10-01',
    '?from=2026-02-30&to=2026-03-01',
  ])('falls back to the default range for %s and cleans the address', async (query) => {
    const { router } = await renderFlow(`${FLOW}${query}&keep=1`);

    await waitFor(() => expect(router.state.location.search).toBe('?keep=1'));
    expect(router.state.historyAction).toBe('REPLACE');
    await analyticsShown();
    expect(rangeButton()).toHaveTextContent('Last 30 days');
    for (const request of mock.current.requestsTo('GET', ANALYTICS)) {
      expect(request.params).toMatchObject({ from: addDays(today, -29), to: today });
    }
  });

  it('cleans a range ending in the future', async () => {
    const { router } = await renderFlow(`${FLOW}?from=${today}&to=${addDays(today, 1)}`);

    await waitFor(() => expect(router.state.location.search).toBe(''));
    await analyticsShown();
    expect(lastAnalyticsParams()).toMatchObject({ from: addDays(today, -29), to: today });
  });
});

describe('custom date range', () => {
  function fillCustom(picker: HTMLElement, from: string, to: string) {
    fireEvent.change(within(picker).getByLabelText('From'), { target: { value: from } });
    fireEvent.change(within(picker).getByLabelText('To'), { target: { value: to } });
    fireEvent.click(within(picker).getByRole('button', { name: 'Apply' }));
  }

  it('applies a custom range', async () => {
    const { router } = await renderFlow();
    await analyticsShown();

    const picker = await openPicker();
    // Prefilled with the range in use.
    expect(within(picker).getByLabelText('From')).toHaveValue(addDays(today, -29));
    expect(within(picker).getByLabelText('To')).toHaveValue(today);
    expect(within(picker).getByLabelText('To')).toHaveAttribute('max', today);
    fillCustom(picker, '2026-10-01', '2026-10-15');

    await waitFor(() =>
      expect(router.state.location.search).toBe('?from=2026-10-01&to=2026-10-15'),
    );
    await waitFor(() =>
      expect(lastAnalyticsParams()).toEqual({
        from: '2026-10-01',
        to: '2026-10-15',
        timeZone: browserTimeZone(),
      }),
    );
    await analyticsShown();
    expect(rangeButton()).toHaveTextContent('1 Oct – 15 Oct');
    expect(kpiCaption()).toBe('1 Oct – 15 Oct');
  });

  it('keeps a custom range from the address on reload', async () => {
    await renderFlow(`${FLOW}?from=2026-10-01&to=2026-10-15`);
    await analyticsShown();

    expect(rangeButton()).toHaveAccessibleName('Date range: 1 Oct – 15 Oct');
    expect(lastAnalyticsParams()).toMatchObject({ from: '2026-10-01', to: '2026-10-15' });
  });

  it.each([
    ['the start after the end', '2026-10-15', '2026-10-01', 'From', RANGE_ERRORS.inverted],
    ['more than 366 days', '2025-01-01', '2026-01-02', 'From', RANGE_ERRORS.tooLong],
    ['an end in the future', '2026-10-01', 'tomorrow', 'To', RANGE_ERRORS.futureTo],
    ['a missing start', '', '2026-10-15', 'From', RANGE_ERRORS.invalidFrom],
    ['a missing end', '2026-10-01', '', 'To', RANGE_ERRORS.invalidTo],
  ])('rejects %s inline', async (_, from, to, field, message) => {
    const { router } = await renderFlow();
    await analyticsShown();
    const requests = mock.current.requestsTo('GET', ANALYTICS).length;

    const picker = await openPicker();
    fillCustom(picker, from, to === 'tomorrow' ? addDays(today, 1) : to);

    const input = within(picker).getByLabelText(field);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const error = within(picker).getByText(message);
    expect(error).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-describedby', error.id);
    expect(input).toHaveAccessibleDescription(message);
    // The (first) invalid field takes the focus, so the error is announced.
    expect(input).toHaveFocus();
    // Nothing applied: the popover stays open on the same range.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
    expect(mock.current.requestsTo('GET', ANALYTICS)).toHaveLength(requests);
  });

  it('moves the focus to the start date when both dates are invalid', async () => {
    await renderFlow();
    await analyticsShown();

    const picker = await openPicker();
    fillCustom(picker, '', '');

    expect(within(picker).getByLabelText('From')).toHaveFocus();
    expect(within(picker).getByLabelText('To')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reads "today" again when the picker opens, for a page left open past midnight', async () => {
    const { router } = await renderFlow();
    await analyticsShown();
    vi.setSystemTime(new Date(NOW.getTime() + 24 * 3_600_000));
    const tomorrow = localToday(browserTimeZone());

    const picker = await openPicker();
    expect(within(picker).getByLabelText('To')).toHaveAttribute('max', tomorrow);
    fillCustom(picker, today, tomorrow);

    await waitFor(() => expect(router.state.location.search).toBe(`?from=${today}&to=${tomorrow}`));
    await waitFor(() => expect(lastAnalyticsParams()).toMatchObject({ from: today, to: tomorrow }));
  });

  it('can be used with the keyboard', async () => {
    await renderFlow();
    await analyticsShown();

    const picker = await openPicker();
    // The popover moves the focus inside; Escape closes it and returns the focus.
    await waitFor(() => expect(picker).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rangeButton()).toHaveFocus();
  });
});

describe('card details over a range', () => {
  it('keeps the range when a card opens and closes', async () => {
    const { router } = await renderFlow(`${FLOW}?range=14d`);
    await analyticsShown();

    const chart = screen.getByRole('figure', { name: 'Cycle time' });
    fireEvent.click(within(chart).getByRole('button', { name: 'View data' }));
    const link = within(chart).getByRole('link', { name: 'SB-1' });
    expect(link).toHaveAttribute('href', `${FLOW}/cards/SB-1?range=14d`);
    fireEvent.click(link);

    const dialog = await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    expect(router.state.location.pathname).toBe(`${FLOW}/cards/SB-1`);
    expect(router.state.location.search).toBe('?range=14d');
    // The page behind keeps its range (no new request).
    expect(mock.current.requestsTo('GET', ANALYTICS)).toHaveLength(1);

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(router.state.location.pathname).toBe(FLOW));
    expect(router.state.location.search).toBe('?range=14d');
  });

  it('keeps the range when a card opened by its address closes', async () => {
    const { router } = await renderFlow(`${FLOW}/cards/SB-1?from=2026-10-01&to=2026-10-15`);

    const dialog = await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    expect(lastAnalyticsParams()).toMatchObject({ from: '2026-10-01', to: '2026-10-15' });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(router.state.location.pathname).toBe(FLOW));
    expect(router.state.location.search).toBe('?from=2026-10-01&to=2026-10-15');
  });
});

describe('range-dependent texts', () => {
  it('describes the selected range in the charts and in the Little’s law block', async () => {
    const data = analyticsWith();
    await renderFlowPage(mock, `${FLOW}?from=2026-10-19&to=2026-11-17`, {
      analytics: [ok(data)],
    });
    await analyticsShown();

    expect(screen.getByTestId('littles-law-period')).toHaveTextContent(
      'Averages over 19 Oct – 17 Nov (30 days).',
    );
    expect(
      within(screen.getByRole('figure', { name: 'Throughput' })).getByRole('img'),
    ).toHaveAccessibleName(/^Throughput per day, 19 Oct – 17 Nov: 7 cards/);
    expect(
      within(screen.getByRole('figure', { name: 'Cycle time' })).getByRole('img'),
    ).toHaveAccessibleName(/completed 19 Oct – 17 Nov/);
  });
});

describe('activity panel on Flow', () => {
  const moved = activityWith(
    {
      type: 'CARD_MOVED',
      payload: {
        card: { key: 'SB-1', title: 'Fix login' },
        from: { id: 'col-progress', name: 'In Progress' },
        to: { id: 'col-done', name: 'Done' },
      },
    },
    { id: 'a1', cardId: 'card-SB-1', createdAt: '2026-11-17T09:00:00.000Z' },
  );

  async function openActivity(): Promise<HTMLElement> {
    mock.current.on('GET', `${BOARD}/activity`, {
      status: 200,
      data: { activities: [moved], nextCursor: null },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    const panel = await screen.findByRole('dialog', { name: 'Activity' });
    await within(panel).findByRole('link', { name: /SB-1 Fix login/ });
    return panel;
  }

  it('opens a card over Flow, keeping the range', async () => {
    const { router } = await renderFlow(`${FLOW}?range=90d`);
    await analyticsShown();
    const panel = await openActivity();

    const link = within(panel).getByRole('link', { name: /SB-1 Fix login/ });
    expect(link).toHaveAttribute('href', `${FLOW}/cards/SB-1?range=90d`);
    fireEvent.click(link);

    await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    expect(router.state.location.pathname).toBe(`${FLOW}/cards/SB-1`);
    expect(router.state.location.search).toBe('?range=90d');
  });

  it('opens a card over the board from the board', async () => {
    const { router } = await renderFlow();
    await analyticsShown();
    await router.navigate(BOARD);
    await screen.findByRole('heading', { level: 1, name: 'Sprint board' });
    const panel = await openActivity();

    const link = within(panel).getByRole('link', { name: /SB-1 Fix login/ });
    expect(link).toHaveAttribute('href', `${BOARD}/cards/SB-1`);
  });
});

describe('coming back to an open board', () => {
  /** Records every status the opened board goes through from now on. */
  function recordStatuses(): { statuses: string[]; stop: () => void } {
    const statuses: string[] = [];
    const stop = useBoardStore.subscribe((state) => statuses.push(state.boardStatus));
    return { statuses, stop };
  }

  it('keeps the board on screen from Flow to Board and refreshes it in the background', async () => {
    const { router } = await renderFlow();
    await analyticsShown();
    const boardReads = mock.current.requestsTo('GET', BOARD).length;
    const { statuses, stop } = recordStatuses();

    await act(() => router.navigate(BOARD));

    // At once, without a skeleton in between.
    expect(screen.getByRole('heading', { level: 1, name: 'Sprint board' })).toBeInTheDocument();
    expect(screen.queryByText('Loading board...')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Board views' })).toBeInTheDocument();
    await waitFor(() => expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(boardReads + 1));
    stop();
    expect(statuses).not.toContain('loading');
  });

  it('reads the board again when it is opened again, also without live updates', async () => {
    // The socket of the board page never connects in these tests.
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockFlowBoard(mock);
    const { router } = renderApp(BOARD);
    await screen.findByRole('heading', { level: 1, name: 'Sprint board' });
    await screen.findByText('SB-1');
    await act(() => router.navigate('/boards'));
    const boardReads = mock.current.requestsTo('GET', BOARD).length;
    const cardReads = mock.current.requestsTo('GET', `${BOARD}/cards`).length;
    const { statuses, stop } = recordStatuses();

    await act(() => router.navigate(BOARD));

    expect(screen.getByRole('heading', { level: 1, name: 'Sprint board' })).toBeInTheDocument();
    expect(screen.queryByText('Loading board...')).toBeNull();
    await waitFor(() => expect(mock.current.requestsTo('GET', BOARD)).toHaveLength(boardReads + 1));
    await waitFor(() =>
      expect(mock.current.requestsTo('GET', `${BOARD}/cards`)).toHaveLength(cardReads + 1),
    );
    stop();
    expect(statuses).not.toContain('loading');
  });
});
