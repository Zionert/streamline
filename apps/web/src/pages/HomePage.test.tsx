import { fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '@/routes';
import { resetAuthStore, useAuthStore } from '@/stores/auth';
import { sessionWith } from '@/test/fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('HomePage', () => {
  beforeEach(() => {
    resetAuthStore();
    useAuthStore.getState().setSession(sessionWith('token-1'));
  });

  it('renders the landing page on "/" and reports a healthy API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'StreamLine' })).toBeInTheDocument();
    expect(await screen.findByText('API is online')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('reports an unavailable API when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    renderAt('/');

    expect(await screen.findByText('API is unavailable')).toBeInTheDocument();
  });

  it('reports an unavailable API when the response does not match the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'down' })));

    renderAt('/');

    expect(await screen.findByText('API is unavailable')).toBeInTheDocument();
  });

  it('re-checks the API when the button is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    renderAt('/');
    expect(await screen.findByText('API is unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check API status' }));

    expect(await screen.findByText('API is online')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
