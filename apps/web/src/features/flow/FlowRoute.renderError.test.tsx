import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { sessionWith } from '@/test/fixtures';
import { renderApp, setupMockApi } from '@/test/renderApp';

// The page loads, but rendering it throws.
vi.mock('./FlowPage', () => ({
  default: function BrokenFlowPage(): never {
    throw new Error('Cannot read properties of undefined');
  },
}));

setupMockApi();

describe('Flow route when the page fails to render', () => {
  it('shows an error inside the app instead of replacing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useAuthStore.getState().setSession(sessionWith('token-1'));
    renderApp('/boards/board-1/flow');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the Flow page.');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
