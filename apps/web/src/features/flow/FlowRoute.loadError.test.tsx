import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith } from '@/test/fixtures';
import { renderApp, setupMockApi } from '@/test/renderApp';

// The page's chunk cannot be loaded (e.g. removed by a new deployment).
vi.mock('./FlowPage', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

setupMockApi();

describe('Flow route when the page code fails to load', () => {
  it('shows an error with Reload and a link back to the board, inside the app', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    useAuthStore.getState().setSession(sessionWith('token-1'));
    renderApp('/boards/board-1/flow');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the Flow page.');
    // The app shell stays.
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute(
      'href',
      '/boards/board-1',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledOnce();
  });
});
