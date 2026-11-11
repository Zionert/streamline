import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { RouterProvider, createMemoryRouter, type InitialEntry } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';

import { api } from '@/lib/api';
import { routes } from '@/routes';
import { resetAuthStore } from '@/stores/auth';

import { createMockAdapter, type MockAdapter } from './mockAdapter';

/** Renders the whole route tree (including session bootstrap) in a memory router. */
export function renderApp(initialEntry: InitialEntry = '/', options: { strict?: boolean } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const tree = <RouterProvider router={router} />;
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, router };
}

/**
 * Routes the shared `api` instance through an in-memory adapter for the duration of each test,
 * resets the auth store, and stubs `fetch` for the API health widget on the home page.
 */
export function setupMockApi(): { readonly current: MockAdapter } {
  const ref = { current: createMockAdapter() };
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    ref.current = createMockAdapter();
    api.defaults.adapter = ref.current.adapter;
    resetAuthStore();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  return ref;
}
