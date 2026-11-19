import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AssistantMarkdown, type MarkdownBoard } from './AssistantMarkdown';

const BOARD: MarkdownBoard = { id: 'board-1', key: 'SB' };

function renderMarkdown(
  content: string,
  board: MarkdownBoard | null = BOARD,
  path = '/boards/board-1',
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<AssistantMarkdown content={content} board={board} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssistantMarkdown', () => {
  it('renders Markdown with GitHub tables and lists', () => {
    const { container } = renderMarkdown(
      '## Summary\n\n- **one**\n- two\n\n| Card | Days |\n|---|---|\n| A | 3 |\n\n`code`',
    );

    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
    expect(container.querySelector('code')).toHaveTextContent('code');
    expect(container.querySelector('strong')).toHaveTextContent('one');
  });

  it('never renders raw HTML: tags stay visible as inert text', () => {
    const { container } = renderMarkdown(
      'Look <script>alert(1)</script> and <img src=x onerror="alert(2)"> here.\n\n<div onclick="x()">block</div>',
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('div div div')).toBeNull();
    expect(container).toHaveTextContent('<script>');
    expect(container).toHaveTextContent('<img src=x onerror="alert(2)">');
  });

  it('does not load images, only shows their alternative text', () => {
    const { container } = renderMarkdown('![Burn-up chart](https://example.com/chart.png)');

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('[Burn-up chart]');
  });

  it('opens external links in a new tab without passing the opener or ranking', () => {
    renderMarkdown('See [the docs](https://example.com/docs).');

    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it.each([
    ['protocol-relative', '//evil.example/path'],
    ['backslash', '/\\evil.example'],
    ['other scheme', 'ftp://files.example'],
    ['relative', 'help/page'],
  ])('shows a %s link as plain text', (_kind, href) => {
    renderMarkdown(`[target](${href})`);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('target').tagName).toBe('SPAN');
  });

  it('opens an in-app path through the router in the same tab', () => {
    renderMarkdown('[Your boards](/boards)');

    const link = screen.getByRole('link', { name: 'Your boards' });
    expect(link).toHaveAttribute('href', '/boards');
    expect(link).not.toHaveAttribute('target');
  });

  it('drops javascript: links', () => {
    renderMarkdown('[click](javascript:alert(1))');

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it("links the keys of this board's cards to the card details and leaves other keys as text", () => {
    renderMarkdown('At risk: SB-12 and SB-7 (see also XY-3, SBX-4, SB-0, SB-12a). `SB-9` in code.');

    expect(screen.getByRole('link', { name: 'SB-12' })).toHaveAttribute(
      'href',
      '/boards/board-1/cards/SB-12',
    );
    expect(screen.getByRole('link', { name: 'SB-7' })).toHaveAttribute(
      'href',
      '/boards/board-1/cards/SB-7',
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText(/XY-3, SBX-4, SB-0, SB-12a/)).toBeInTheDocument();
  });

  it('links card keys over the Flow page while it is shown', () => {
    renderMarkdown('Check SB-3.', BOARD, '/boards/board-1/flow?from=2026-11-01');

    expect(screen.getByRole('link', { name: 'SB-3' })).toHaveAttribute(
      'href',
      '/boards/board-1/flow/cards/SB-3?from=2026-11-01',
    );
  });

  it('links no keys outside a board', () => {
    renderMarkdown('Card SB-12', null);

    expect(screen.queryByRole('link')).toBeNull();
  });
});
