import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { RouterProvider, createMemoryRouter, type InitialEntry } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach } from 'vitest';

import { AppToaster } from '@/components/layout/AppToaster';
import { api } from '@/lib/api';
import { routes } from '@/routes';
import { resetAuthStore } from '@/stores/auth';
import { resetBoardStore } from '@/stores/board';

import { createMockAdapter, type MockAdapter } from './mockAdapter';

/**
 * Renders the whole route tree (including session bootstrap) in a memory router, next to the
 * toast container like in `main.tsx`.
 */
export function renderApp(initialEntry: InitialEntry = '/', options: { strict?: boolean } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const tree = (
    <>
      <RouterProvider router={router} />
      <AppToaster />
    </>
  );
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, router };
}

/**
 * Routes the shared `api` instance through an in-memory adapter for the duration of each test and
 * resets the auth and board stores. `GET /boards` answers with an empty list by default (the
 * landing page of a logged-in user); tests override it with `on()`.
 */
export function setupMockApi(): { readonly current: MockAdapter } {
  const ref = { current: createMockAdapter() };
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    ref.current = createMockAdapter();
    ref.current.on('GET', '/boards', { status: 200, data: { boards: [] } });
    api.defaults.adapter = ref.current.adapter;
    resetAuthStore();
    resetBoardStore();
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    toast.dismiss();
  });

  return ref;
}
