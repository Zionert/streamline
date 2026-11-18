import type { AnalyticsResponse, ForecastResponse } from '@streamline/shared';
import { screen } from '@testing-library/react';

import { useAuthStore } from '@/stores/auth';

import {
  boardWith,
  cardListFor,
  cardWith,
  defaultColumns,
  memberWith,
  sessionWith,
} from './fixtures';
import { analyticsWith, countForecast } from './flowFixtures';
import type { MockAdapter, MockResponder } from './mockAdapter';
import { renderApp } from './renderApp';

export const BOARD = '/boards/board-1';
export const FLOW = `${BOARD}/flow`;
export const ANALYTICS = `${BOARD}/analytics`;
export const FORECAST = `${ANALYTICS}/forecast`;
export const AGING = `${ANALYTICS}/aging`;

/** SB-1, completed (in the Done column); the first point of the analytics fixture. */
export const fixLogin = cardWith({
  id: 'card-SB-1',
  number: 1,
  columnId: 'col-done',
  rank: 'd',
  title: 'Fix login',
});

export const ok = (data: AnalyticsResponse | ForecastResponse) => ({ status: 200, data });

/** Mocks the board-1 endpoints of the board page, the card details of SB-1 and the aging. */
export function mockFlowBoard(mock: { readonly current: MockAdapter }): void {
  const columns = defaultColumns();
  mock.current.on('GET', BOARD, { status: 200, data: { board: boardWith() } });
  mock.current.on('GET', `${BOARD}/columns`, { status: 200, data: { columns } });
  mock.current.on('GET', `${BOARD}/members`, { status: 200, data: { members: [memberWith()] } });
  mock.current.on('GET', `${BOARD}/cards`, {
    status: 200,
    data: cardListFor(columns, [fixLogin]),
  });
  mock.current.on('GET', `${BOARD}/labels`, { status: 200, data: { labels: [] } });
  mock.current.on('GET', `${BOARD}/cards/${fixLogin.id}/comments`, {
    status: 200,
    data: { comments: [], nextCursor: null },
  });
  mock.current.on('GET', `${BOARD}/cards/${fixLogin.id}/activity`, {
    status: 200,
    data: { activities: [], nextCursor: null },
  });
  mock.current.on('GET', AGING, {
    status: 200,
    data: { generatedAt: '2026-11-17T09:30:00.000Z', thresholdDays: null, items: [] },
  });
}

export interface RenderFlowOptions {
  analytics?: MockResponder[];
  forecast?: MockResponder[];
}

/** Logs in and renders `path` (a Flow address) once the page heading is shown. */
export async function renderFlowPage(
  mock: { readonly current: MockAdapter },
  path = FLOW,
  options: RenderFlowOptions = {},
) {
  useAuthStore.getState().setSession(sessionWith('token-1'));
  mockFlowBoard(mock);
  mock.current.on('GET', ANALYTICS, ...(options.analytics ?? [ok(analyticsWith())]));
  mock.current.on('GET', FORECAST, ...(options.forecast ?? [ok(countForecast())]));
  const result = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Flow', hidden: true });
  return result;
}

/** Waits for the analytics to be shown (the key figures render with them). */
export function analyticsShown() {
  return screen.findByLabelText('Key figures');
}
