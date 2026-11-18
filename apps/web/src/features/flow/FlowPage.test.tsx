import { addDays, type AnalyticsResponse, type ForecastResponse } from '@streamline/shared';
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
import {
  SCATTER_POINTS,
  analyticsWith,
  countForecast,
  dateForecast,
  emptyAnalytics,
  horizonExceededForecast,
  insufficientForecast,
} from '@/test/flowFixtures';
import { setMediaQuery } from '@/test/matchMedia';
import { deferred, errorBody, type MockResponder } from '@/test/mockAdapter';
import { renderApp, setupMockApi } from '@/test/renderApp';

import { browserTimeZone } from './flowFormat';
import { targetDateBounds } from './forecastInput';

const mock = setupMockApi();

const BOARD = '/boards/board-1';
const FLOW = `${BOARD}/flow`;
const ANALYTICS = `${BOARD}/analytics`;
const FORECAST = `${ANALYTICS}/forecast`;

const fixLogin = cardWith({
  id: 'card-SB-1',
  number: 1,
  columnId: 'col-done',
  rank: 'd',
  title: 'Fix login',
});

/** Mocks everything the board needs (as on the board page) for `boardId`. */
function mockBoard(boardId: string, name: string) {
  const base = `/boards/${boardId}`;
  const columns = defaultColumns(boardId);
  mock.current.on('GET', base, {
    status: 200,
    data: { board: boardWith({ id: boardId, name, key: boardId === 'board-1' ? 'SB' : 'OT' }) },
  });
  mock.current.on('GET', `${base}/columns`, { status: 200, data: { columns } });
  mock.current.on('GET', `${base}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', `${base}/cards`, {
    status: 200,
    data: cardListFor(columns, boardId === 'board-1' ? [fixLogin] : []),
  });
  mock.current.on('GET', `${base}/labels`, { status: 200, data: { labels: [] } });
}

interface RenderOptions {
  analytics?: MockResponder[];
  forecast?: MockResponder[];
}

async function renderFlow(path = FLOW, options: RenderOptions = {}) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockBoard('board-1', 'Sprint board');
  mock.current.on(
    'GET',
    ANALYTICS,
    ...(options.analytics ?? [{ status: 200, data: analyticsWith() }]),
  );
  mock.current.on(
    'GET',
    FORECAST,
    ...(options.forecast ?? [{ status: 200, data: countForecast() }]),
  );
  mock.current.on('GET', `${BOARD}/cards/${fixLogin.id}/comments`, {
    status: 200,
    data: { comments: [], nextCursor: null },
  });
  mock.current.on('GET', `${BOARD}/cards/${fixLogin.id}/activity`, {
    status: 200,
    data: { activities: [], nextCursor: null },
  });
  const result = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Flow', hidden: true });
  return result;
}

const ok = (data: AnalyticsResponse | ForecastResponse) => ({ status: 200, data });

const figure = (name: string) => screen.getByRole('figure', { name });

function showData(name: string) {
  fireEvent.click(within(figure(name)).getByRole('button', { name: 'View data' }));
  return within(figure(name)).getByRole('table');
}

/** Names in the legend row of reference lines above a chart's plot. */
function legendLabels(chart: HTMLElement): string[] {
  return within(chart)
    .getAllByRole('listitem')
    .filter((item) => item.closest('[aria-label="Reference lines"]'))
    .map((item) => item.textContent);
}

/** Every text drawn inside the chart's SVG (axis ticks, any in-plot labels). */
function svgTexts(chart: HTMLElement): string[] {
  return [...chart.querySelectorAll('svg text')].map((text) => text.textContent);
}

/** Labels of the X axis ticks. */
function xTicks(chart: HTMLElement): string[] {
  return [
    ...chart.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'),
  ].map((text) => text.textContent);
}

/** Waits for the analytics to be shown (the key figures render with them). */
function analyticsShown() {
  return screen.findByLabelText('Key figures');
}

describe('Flow page route', () => {
  it('renders the lazily loaded page with its header, in the browser time zone', async () => {
    await renderFlow();
    await analyticsShown();

    expect(screen.getByText('SB', { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    const range = screen.getByRole('button', { name: 'Last 30 days' });
    expect(range).toHaveAttribute('aria-disabled', 'true');
    expect(range).toHaveAttribute('aria-description', 'Custom ranges are coming soon');
    expect(screen.getByText(browserTimeZone())).toBeInTheDocument();
    // The default range of the API: no `from` / `to`, only the time zone.
    expect(mock.current.requestsTo('GET', ANALYTICS)[0]?.params).toEqual({
      timeZone: browserTimeZone(),
    });
  });

  it('keeps the content in a centred column on wide screens', async () => {
    await renderFlow();
    await analyticsShown();

    const heading = screen.getByRole('heading', { level: 1, name: 'Flow' });
    const column = heading.closest('.max-w-\\[1440px\\]');
    expect(column).toHaveClass('mx-auto', 'w-full');
    expect(column).toContainElement(screen.getByLabelText('Key figures'));
    expect(column).toContainElement(figure('Cycle time'));
    // The scatter grows a little on wide screens; the other charts keep their height.
    const [scatterPlot] = figure('Cycle time').getElementsByClassName('xl:h-[300px]');
    expect(scatterPlot).toBeDefined();
    expect(figure('Throughput').getElementsByClassName('xl:h-[300px]')).toHaveLength(0);
    // The forecast field has a fixed width next to its button (full width below 640 px).
    const field = within(screen.getByRole('region', { name: 'Forecast' }))
      .getByLabelText('Cards to finish')
      .closest('div');
    expect(field).toHaveClass('w-full', 'sm:w-48');
  });

  it('marks Flow as the current view in the top bar', async () => {
    await renderFlow();

    const views = screen.getByRole('navigation', { name: 'Board views' });
    const flow = within(views).getByRole('link', { name: 'Flow' });
    expect(flow).toHaveAttribute('href', FLOW);
    expect(flow).toHaveAttribute('aria-current', 'page');
    expect(within(views).getByRole('link', { name: 'Board' })).not.toHaveAttribute('aria-current');
  });

  it('shows skeletons while the analytics load', async () => {
    const pending = deferred<{ status: number; data: AnalyticsResponse }>();
    await renderFlow(FLOW, { analytics: [() => pending.promise] });

    expect(screen.getByRole('status')).toHaveTextContent('Loading flow analytics...');
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
    expect(screen.getAllByTestId('chart-skeleton')).toHaveLength(3);

    pending.resolve(ok(analyticsWith()) as { status: number; data: AnalyticsResponse });

    await analyticsShown();
    expect(screen.queryByText('Loading flow analytics...')).toBeNull();
  });

  it('reports a failure with a Retry button', async () => {
    await renderFlow(FLOW, {
      analytics: [{ status: 500, data: errorBody('INTERNAL_SERVER_ERROR') }, ok(analyticsWith())],
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the flow analytics.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    await analyticsShown();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mock.current.requestsTo('GET', ANALYTICS)).toHaveLength(2);
  });

  it('shows "Board not found" when the analytics answer 404', async () => {
    await renderFlow(FLOW, { analytics: [{ status: 404, data: errorBody('NOT_FOUND') }] });

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your boards' })).toHaveAttribute(
      'href',
      '/boards',
    );
  });

  it('shows "Board not found" when the board itself is gone', async () => {
    useAuthStore.getState().setSession(sessionWith('token-1'));
    mockBoard('board-1', 'Sprint board');
    mock.current.on('GET', BOARD, { status: 404, data: errorBody('NOT_FOUND') });
    mock.current.on('GET', ANALYTICS, { status: 404, data: errorBody('NOT_FOUND') });
    renderApp(FLOW);

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
  });

  it('replaces the charts with an empty state when nothing was completed', async () => {
    await renderFlow(FLOW, { analytics: [ok(emptyAnalytics())] });

    expect(await screen.findByRole('heading', { name: 'No completed work yet' })).toBeVisible();
    expect(
      screen.getByText(
        'Flow charts appear once cards reach a Done column. Move a few cards through In progress to Done.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to board' })).toHaveAttribute('href', BOARD);
    // The key figures still render; the charts and the forecast do not.
    expect(screen.getAllByTestId('kpi-tile')).toHaveLength(4);
    expect(screen.queryByRole('figure')).toBeNull();
    expect(mock.current.requestsTo('GET', FORECAST)).toHaveLength(0);
  });

  it('drops the analytics of a board that is no longer shown', async () => {
    const late = deferred<{ status: number; data: AnalyticsResponse }>();
    const { router } = await renderFlow(FLOW, { analytics: [() => late.promise] });
    mockBoard('board-2', 'Other board');
    const other = analyticsWith({
      littlesLaw: { ...analyticsWith().littlesLaw, avgWip: 9.9 },
    });
    mock.current.on('GET', '/boards/board-2/analytics', ok(other));
    mock.current.on('GET', '/boards/board-2/analytics/forecast', ok(countForecast()));

    await router.navigate('/boards/board-2/flow');
    await waitFor(() =>
      expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 9.9'),
    );

    // The response for the first board arrives late and is ignored.
    late.resolve(ok(analyticsWith()) as { status: number; data: AnalyticsResponse });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('littles-law-equation')).toHaveTextContent('Avg WIP 9.9');
  });
});

describe('key figures', () => {
  it('shows completed cards, cycle and lead time percentiles and work in progress', async () => {
    await renderFlow();
    await analyticsShown();

    const tiles = screen.getAllByTestId('kpi-tile');
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'Completed7last 30 days',
      'Cycle time p858.3 dp50 4.1 d',
      'Lead time p8517.2 dp50 9.4 d',
      'In progress32 aging',
    ]);
    expect(within(tiles[3] as HTMLElement).getByText('2 aging')).toHaveClass('text-warning-text');
  });

  it('shows a dash for percentiles that need more samples', async () => {
    await renderFlow(FLOW, {
      analytics: [
        ok(
          analyticsWith({
            leadCycle: {
              points: SCATTER_POINTS.slice(0, 3),
              leadTime: { count: 3, p50: 9.4, p85: null, p95: null },
              cycleTime: { count: 3, p50: 4.1, p85: null, p95: null },
            },
          }),
        ),
      ],
    });
    await analyticsShown();

    const [, cycle, lead] = screen.getAllByTestId('kpi-tile');
    expect(cycle).toHaveTextContent('Cycle time p85—p50 4.1 d');
    expect(lead).toHaveTextContent('Lead time p85—p50 9.4 d');
  });
});

describe('cycle time chart', () => {
  it('draws the labelled percentile lines and describes the chart', async () => {
    await renderFlow();
    await analyticsShown();

    const chart = figure('Cycle time');
    const svg = within(chart).getByRole('img');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAccessibleName(
      'Cycle time of 6 cards completed 19 Oct – 17 Nov: p50 4.1 days, p85 8.3 days, p95 11.6 days.',
    );
    // The lines are named in a legend above the plot, never inside it (no overlaps).
    expect(legendLabels(chart)).toEqual(['p50 · 4.1 d', 'p85 · 8.3 d', 'p95 · 11.6 d']);
    expect(svgTexts(chart).filter((text) => /^p\d/.test(text))).toEqual([]);
    expect(within(chart).getAllByTestId('cycle-time-point')).toHaveLength(6);
    expect(
      within(chart).getByText('1 completed card without cycle time is not shown'),
    ).toBeInTheDocument();
    expect(within(chart).queryByText(/Percentiles need at least/)).toBeNull();
  });

  it('hides the lines of unknown percentiles and explains why', async () => {
    await renderFlow(FLOW, {
      analytics: [
        ok(
          analyticsWith({
            leadCycle: {
              points: SCATTER_POINTS.slice(0, 3),
              leadTime: { count: 3, p50: 9.4, p85: null, p95: null },
              cycleTime: { count: 3, p50: 4.1, p85: null, p95: null },
            },
          }),
        ),
      ],
    });
    await analyticsShown();

    const chart = figure('Cycle time');
    expect(legendLabels(chart)).toEqual(['p50 · 4.1 d']);
    expect(within(chart).queryByText(/^p85/)).toBeNull();
    expect(within(chart).queryByText(/^p95/)).toBeNull();
    expect(
      within(chart).getByText('Percentiles need at least 5 completed cards (3 so far).'),
    ).toBeInTheDocument();
  });

  it('colours the legend: p50 label in the subtle text colour, its line in the Done colour', async () => {
    const tokens = document.createElement('style');
    tokens.textContent =
      ':root { --cat-done: #1f8a56; --text-subtle: #55585f; --warning-text: #8a5300; --destructive: #b42318; }';
    document.head.append(tokens);
    try {
      await renderFlow();
      await analyticsShown();

      const items = within(figure('Cycle time'))
        .getByRole('list', { name: 'Reference lines' })
        .querySelectorAll('li');
      const [p50, p85, p95] = [...items];
      expect(p50).toHaveStyle({ color: '#55585f' });
      expect(p50?.querySelector('line')).toHaveAttribute('stroke', '#1f8a56');
      expect(p50?.querySelector('line')).toHaveAttribute('stroke-dasharray', '4 3');
      expect(p85).toHaveStyle({ color: '#8a5300' });
      expect(p95).toHaveStyle({ color: '#b42318' });
    } finally {
      tokens.remove();
    }
  });

  it('puts the completions on a time axis of the range with a tick every Monday', async () => {
    await renderFlow();
    await analyticsShown();

    // The range runs from Mon 19 Oct to Tue 17 Nov (UTC).
    expect(xTicks(figure('Cycle time'))).toEqual(['19 Oct', '26 Oct', '2 Nov', '9 Nov', '16 Nov']);
  });

  it('shows fewer ticks on a narrow screen', async () => {
    setMediaQuery('(max-width: 639px)', true);
    const days = Array.from({ length: 14 }, (_, index) => addDays('2026-11-04', index));
    const data = analyticsWith();
    data.range = { ...data.range, from: '2026-11-04' };
    data.throughput.daily = days.map((date) => ({ date, count: 1 }));
    data.cumulativeFlow = data.cumulativeFlow.slice(-14);
    data.leadCycle.points = SCATTER_POINTS.filter((point) => point.completedAt >= '2026-11-04');
    await renderFlow(FLOW, { analytics: [ok(data)] });
    await analyticsShown();

    // 14 days get daily ticks, thinned to at most 5 on a narrow screen: every third day.
    const expected = ['4 Nov', '7 Nov', '10 Nov', '13 Nov', '16 Nov'];
    expect(xTicks(figure('Cycle time'))).toEqual(expected);
    expect(xTicks(figure('Throughput'))).toEqual(expected);
    expect(xTicks(figure('Cumulative flow'))).toEqual(expected);
  });

  it('lists the cards in a data table whose keys open the card over the page', async () => {
    const { router } = await renderFlow();
    await analyticsShown();
    const toggle = within(figure('Cycle time')).getByRole('button', { name: 'View data' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    const table = showData('Cycle time');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(table).getAllByRole('row')).toHaveLength(SCATTER_POINTS.length + 1);
    expect(within(table).getByRole('row', { name: /SB-7/ })).toHaveTextContent('—');
    const link = within(table).getByRole('link', { name: 'SB-1' });
    expect(link).toHaveAttribute('href', `${FLOW}/cards/SB-1`);

    fireEvent.click(link);

    const dialog = await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    expect(router.state.location.pathname).toBe(`${FLOW}/cards/SB-1`);
    // The Flow tab stays current behind the card.
    expect(
      within(screen.getByRole('navigation', { name: 'Board views', hidden: true })).getByRole(
        'link',
        { name: 'Flow', hidden: true },
      ),
    ).toHaveAttribute('aria-current', 'page');

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(router.state.location.pathname).toBe(FLOW));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(figure('Cycle time')).toBeInTheDocument();
  });

  it('opens the card of a clicked point', async () => {
    const { router } = await renderFlow();
    await analyticsShown();

    const [first] = within(figure('Cycle time')).getAllByTestId('cycle-time-point');
    fireEvent.click(first as Element);

    await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    expect(router.state.location.pathname).toBe(`${FLOW}/cards/SB-1`);
  });

  it('closes a card opened by its address back to Flow', async () => {
    const { router } = await renderFlow(`${FLOW}/cards/SB-1`);

    const dialog = await screen.findByRole('dialog', { name: /^SB-1 Fix login/ });
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(router.state.location.pathname).toBe(FLOW));
  });

  it('offers to go back to Flow from a missing card', async () => {
    mock.current.on('GET', `${BOARD}/cards/SB-99`, { status: 404, data: errorBody('NOT_FOUND') });
    const { router } = await renderFlow(`${FLOW}/cards/SB-99`);

    const dialog = await screen.findByRole('dialog', { name: 'Card not found' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to Flow' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(FLOW));
  });
});

describe('throughput chart', () => {
  it('switches between days and weeks', async () => {
    await renderFlow();
    await analyticsShown();
    const chart = figure('Throughput');
    const day = within(chart).getByRole('button', { name: 'Day' });
    const week = within(chart).getByRole('button', { name: 'Week' });
    expect(day).toHaveAttribute('aria-pressed', 'true');
    expect(week).toHaveAttribute('aria-pressed', 'false');
    // The average is named above the plot; only its dashed line is drawn over the bars.
    expect(legendLabels(chart)).toEqual(['avg 0.2 / day']);
    expect(svgTexts(chart).filter((text) => text.startsWith('avg'))).toEqual([]);
    expect(xTicks(chart)).toEqual(['19 Oct', '26 Oct', '2 Nov', '9 Nov', '16 Nov']);

    let table = showData('Throughput');
    expect(within(table).getAllByRole('row')).toHaveLength(31);

    fireEvent.click(week);

    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(day).toHaveAttribute('aria-pressed', 'false');
    expect(legendLabels(chart)).toEqual(['avg 1.6 / week']);
    expect(xTicks(chart)).toEqual(['19 Oct', '26 Oct', '2 Nov', '9 Nov', '16 Nov']);
    table = within(chart).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[1]).toHaveTextContent('19 Oct 2026');
    expect(within(chart).getByRole('img')).toHaveAccessibleName(/^Throughput per week: 7 cards/);
  });
});

describe('cumulative flow chart', () => {
  it('has a legend and a data table of the categories', async () => {
    await renderFlow();
    await analyticsShown();
    const chart = figure('Cumulative flow');

    const legend = within(chart).getByRole('list', { name: 'Legend' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Backlog', 'To do', 'In progress', 'Done']);

    const table = showData('Cumulative flow');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Day', 'Backlog', 'To do', 'In progress', 'Done']);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      '19 Oct 20265' + '3' + '2' + '20',
    );
  });

  it('shows the unknown category only when it has cards', async () => {
    const data = analyticsWith();
    data.cumulativeFlow = data.cumulativeFlow.map((point, index) => ({
      ...point,
      unknown: index === 3 ? 1 : 0,
    }));
    await renderFlow(FLOW, { analytics: [ok(data)] });
    await analyticsShown();

    const legend = within(figure('Cumulative flow')).getByRole('list', { name: 'Legend' });
    expect(within(legend).getByText('Unknown')).toBeInTheDocument();
  });
});

describe('forecast panel', () => {
  const panel = () => screen.getByRole('region', { name: 'Forecast' });
  const results = () => within(panel()).findByRole('list', { name: 'Forecast results' });

  it('runs a "when" forecast for all open cards as soon as it opens', async () => {
    await renderFlow();
    const list = await results();

    expect(mock.current.requestsTo('GET', FORECAST)[0]?.params).toEqual({
      mode: 'count',
      timeZone: browserTimeZone(),
    });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      '50%14 Dec 2026Half of the simulations finished by this date',
      '85%22 Dec 202685% of simulations finished by this date (recommended commitment)',
      '95%29 Dec 202695% of simulations finished by this date',
    ]);
    expect(rows[1]).toHaveAttribute('data-recommended', 'true');
    expect(rows[1]).toHaveClass('border-ring');
    expect(rows[0]).not.toHaveAttribute('data-recommended');
    // The long mode labels stack below 640 px and sit side by side above.
    const modes = within(panel()).getByRole('group', { name: 'Forecast question' });
    expect(modes).toHaveClass('flex', 'flex-col', 'sm:inline-flex', 'sm:flex-row');
    expect(modes).not.toHaveClass('inline-flex');
    expect(within(panel()).getByText('When 12 cards will be done:')).toBeInTheDocument();
    expect(
      within(panel()).getByText('Based on throughput from 18 Oct – 16 Nov (31 cards).'),
    ).toBeInTheDocument();
  });

  it('shows skeleton rows while the forecast runs', async () => {
    const pending = deferred<{ status: number; data: ForecastResponse }>();
    await renderFlow(FLOW, { forecast: [() => pending.promise] });
    await analyticsShown();

    expect(within(panel()).getByRole('status')).toHaveTextContent('Running the forecast...');
    expect(within(panel()).getAllByTestId('forecast-row-skeleton')).toHaveLength(3);

    pending.resolve(ok(countForecast()) as { status: number; data: ForecastResponse });
    await results();
  });

  it('forecasts a given number of cards', async () => {
    await renderFlow(FLOW, { forecast: [ok(countForecast()), ok(countForecast(20))] });
    await results();

    const input = within(panel()).getByLabelText('Cards to finish');
    expect(input).toHaveAttribute('placeholder', 'All open cards');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));

    expect(await within(panel()).findByText('When 20 cards will be done:')).toBeInTheDocument();
    expect(mock.current.requestsTo('GET', FORECAST)[1]?.params).toEqual({
      mode: 'count',
      remaining: 20,
      timeZone: browserTimeZone(),
    });
  });

  it('rejects text the browser cannot read as a number instead of forecasting all cards', async () => {
    await renderFlow();
    await results();
    const input = within(panel()).getByLabelText<HTMLInputElement>('Cards to finish');
    // Typing "1e" leaves the value empty and flags the input (jsdom does not emulate that).
    Object.defineProperty(input, 'validity', { value: { badInput: true } });

    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));

    expect(within(panel()).getByText('Enter a whole number from 1 to 10,000.')).toHaveClass(
      'text-destructive',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mock.current.requestsTo('GET', FORECAST)).toHaveLength(1);
  });

  it.each(['0', '2.5', '-3', '10001'])('rejects %s cards without a request', async (value) => {
    await renderFlow();
    await results();
    const input = within(panel()).getByLabelText('Cards to finish');

    fireEvent.change(input, { target: { value } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));

    const message = within(panel()).getByText('Enter a whole number from 1 to 10,000.');
    expect(message).toHaveClass('text-destructive');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a whole number from 1 to 10,000.');
    expect(input).toHaveFocus();
    expect(mock.current.requestsTo('GET', FORECAST)).toHaveLength(1);
  });

  it('forecasts how many cards will be done by a date', async () => {
    const bounds = targetDateBounds(browserTimeZone());
    await renderFlow(FLOW, { forecast: [ok(countForecast()), ok(dateForecast(bounds.min))] });
    await results();

    fireEvent.click(within(panel()).getByRole('button', { name: 'How many by a date?' }));

    expect(within(panel()).getByRole('button', { name: 'How many by a date?' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(panel()).getByText('Choose a date and run the forecast.')).toBeInTheDocument();
    const input = within(panel()).getByLabelText('Target date');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('min', bounds.min);
    expect(input).toHaveAttribute('max', bounds.max);

    fireEvent.change(input, { target: { value: bounds.min } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));

    const list = await results();
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      '50%at least 20 cardsHalf of the simulations completed at least this many',
      '85%at least 14 cards85% of simulations completed at least this many (recommended commitment)',
      '95%at least 11 cards95% of simulations completed at least this many',
    ]);
    expect(mock.current.requestsTo('GET', FORECAST)[1]?.params).toEqual({
      mode: 'date',
      targetDate: bounds.min,
      timeZone: browserTimeZone(),
    });
  });

  it.each([
    ['', 'Choose a target date.'],
    ['today', 'Choose a date after today.'],
    ['too-far', 'Choose a date at most 2 years ahead.'],
  ])('rejects the target date "%s"', async (kind, message) => {
    const bounds = targetDateBounds(browserTimeZone());
    const values: Record<string, string> = {
      '': '',
      today: new Date(Date.parse(`${bounds.min}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10),
      'too-far': new Date(Date.parse(`${bounds.max}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10),
    };
    await renderFlow();
    await results();
    fireEvent.click(within(panel()).getByRole('button', { name: 'How many by a date?' }));
    const input = within(panel()).getByLabelText('Target date');

    fireEvent.change(input, { target: { value: values[kind] } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));

    expect(within(panel()).getByText(message)).toHaveClass('text-destructive');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(mock.current.requestsTo('GET', FORECAST)).toHaveLength(1);
  });

  it('explains when there is not enough history', async () => {
    await renderFlow(FLOW, { forecast: [ok(insufficientForecast())] });

    expect(
      await within(panel()).findByText(
        'Not enough history to forecast. Forecasts use daily throughput from the last 30 days — complete a few cards first.',
      ),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('list', { name: 'Forecast results' })).toBeNull();
  });

  it('explains when the forecast exceeds two years', async () => {
    await renderFlow(FLOW, { forecast: [ok(horizonExceededForecast())] });

    expect(
      await within(panel()).findByText('At the current pace this would take more than 2 years.'),
    ).toBeInTheDocument();
    expect(within(panel()).queryByRole('list', { name: 'Forecast results' })).toBeNull();
  });

  it('reports a failed forecast and retries it with the same parameters', async () => {
    await renderFlow(FLOW, {
      forecast: ['network-error', ok(countForecast())],
    });

    const alert = await within(panel()).findByRole('alert');
    expect(alert).toHaveTextContent('Could not run the forecast.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    await results();
    const requests = mock.current.requestsTo('GET', FORECAST);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.params).toEqual(requests[0]?.params);
  });

  it('shows only the latest forecast when an earlier one answers late', async () => {
    const first = deferred<{ status: number; data: ForecastResponse }>();
    await renderFlow(FLOW, {
      forecast: [() => first.promise, ok(countForecast(20))],
    });
    await analyticsShown();
    fireEvent.change(within(panel()).getByLabelText('Cards to finish'), {
      target: { value: '20' },
    });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Run forecast' }));
    expect(await within(panel()).findByText('When 20 cards will be done:')).toBeInTheDocument();

    first.resolve(ok(countForecast(12)) as { status: number; data: ForecastResponse });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(within(panel()).getByText('When 20 cards will be done:')).toBeInTheDocument();
    expect(within(panel()).queryByText('When 12 cards will be done:')).toBeNull();
  });
});

describe("Little's law", () => {
  const block = () => screen.getByRole('region', { name: "Little's law" });

  it('shows the equation', async () => {
    await renderFlow();
    await analyticsShown();

    expect(within(block()).getByTestId('littles-law-equation')).toHaveTextContent(
      'Avg WIP 4.6 ≈ 0.8 / day × 5.2 d = 4.2',
    );
    expect(
      within(block()).getByText(
        "Little's law: average work in progress ≈ throughput × average cycle time. A large gap means the system is not stable.",
      ),
    ).toBeInTheDocument();
  });

  it.each([
    [
      0.03,
      '+3%',
      'Flow is stable: work in progress matches what throughput and cycle time predict.',
      false,
    ],
    [
      0.2,
      '+20%',
      'Flow is stable: work in progress matches what throughput and cycle time predict.',
      false,
    ],
    [
      -0.2,
      '-20%',
      'Flow is stable: work in progress matches what throughput and cycle time predict.',
      false,
    ],
    [0.25, '+25%', 'More work is in progress than the team finishes — work is piling up.', true],
    [
      -0.3,
      '-30%',
      'Less work in progress than predicted — the period may include unusual spikes.',
      true,
    ],
  ])('relative error %f: pill %s and its verdict', async (relativeError, pill, verdict, warns) => {
    await renderFlow(FLOW, {
      analytics: [
        ok(
          analyticsWith({
            littlesLaw: {
              avgWip: 4,
              avgThroughputPerDay: 1,
              avgCycleTimeDays: 4,
              predictedWip: 4,
              relativeError,
            },
          }),
        ),
      ],
    });
    await analyticsShown();

    const badge = within(block()).getByTestId('littles-law-gap');
    expect(badge).toHaveTextContent(`Difference: ${pill}`);
    expect(within(badge).getByText('Difference:')).toHaveClass('sr-only');
    expect(badge).not.toHaveAttribute('aria-label');
    expect(badge).toHaveClass(warns ? 'text-warning-text' : 'text-subtle');
    expect(within(block()).getByText(verdict)).toBeInTheDocument();
  });

  it('says so when there are not enough completed cards', async () => {
    await renderFlow(FLOW, {
      analytics: [
        ok(
          analyticsWith({
            littlesLaw: {
              avgWip: 2,
              avgThroughputPerDay: 0.1,
              avgCycleTimeDays: null,
              predictedWip: null,
              relativeError: null,
            },
          }),
        ),
      ],
    });
    await analyticsShown();

    expect(
      within(block()).getByText('Not enough completed cards in this period to check.'),
    ).toBeInTheDocument();
    expect(within(block()).getByTestId('littles-law-equation')).toHaveTextContent(
      'Avg WIP 2.0 ≈ 0.1 / day × — = —',
    );
    expect(within(block()).queryByTestId('littles-law-gap')).toBeNull();
  });
});
