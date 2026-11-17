import { DragDropContext, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type { Card, Column } from '@streamline/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';

import { cardWith, columnWith } from '@/test/fixtures';

import { BoardColumn, type BoardColumnProps, type ColumnComposerHandle } from './BoardColumn';

/** Card lists are droppables, so a column needs a drag & drop context around it. */
function withDragContext(children: ReactNode) {
  return <DragDropContext onDragEnd={() => undefined}>{children}</DragDropContext>;
}

function cardsIn(columnId: string, count: number): Card[] {
  return Array.from({ length: count }, (_, index) =>
    cardWith({
      id: `${columnId}-card-${String(index + 1)}`,
      number: index + 1,
      columnId,
      rank: String.fromCharCode(98 + index),
    }),
  );
}

function renderColumn(column: Column, cardCount: number, props: Partial<BoardColumnProps> = {}) {
  return render(
    withDragContext(
      <BoardColumn
        column={column}
        cards={cardsIn(column.id, cardCount)}
        canWrite={false}
        canEditSettings={false}
        {...props}
      />,
    ),
  );
}

/** The props @hello-pangea/dnd puts on a drag handle, including its `role="button"`. */
const dragHandleProps: DraggableProvidedDragHandleProps = {
  'data-rfd-drag-handle-draggable-id': 'col-a',
  'data-rfd-drag-handle-context-id': '0',
  role: 'button',
  'aria-describedby': 'rfd-hidden-text-0',
  tabIndex: 0,
  draggable: false,
  onDragStart: () => {},
};

describe('BoardColumn', () => {
  it('keeps the heading, category and counter outside the drag handle', () => {
    render(
      withDragContext(
        <BoardColumn
          column={columnWith({
            id: 'col-a',
            title: 'Review',
            rank: 'a',
            wipLimit: 1,
            wipStrict: true,
          })}
          cards={cardsIn('col-a', 2)}
          canWrite
          canEditSettings={false}
          dragHandleProps={dragHandleProps}
        />,
      ),
    );

    // A role="button" makes its children presentational; none of these may sit inside it.
    const handle = screen.getByRole('button', { name: 'Drag column Review' });
    expect(handle).toHaveTextContent('');
    const heading = screen.getByRole('heading', { level: 2, name: 'Review' });
    for (const element of [
      heading,
      screen.getByText('Category: To do'),
      screen.getByLabelText('WIP 2 of 1, limit exceeded'),
      screen.getByTitle('Strict WIP limit'),
    ]) {
      expect(element.closest('[role="button"]')).toBeNull();
    }
  });

  it('counts the real cards: "n" without a limit', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 2);

    const region = screen.getByRole('region', { name: 'Review' });
    const counter = within(region).getByLabelText('2 cards');
    expect(counter).toHaveTextContent(/^2/);
    expect(counter).toHaveClass('font-mono', 'text-subtle');
    expect(region).not.toHaveAttribute('data-wip-exceeded');
    const list = within(region).getByRole('list', { name: 'Cards in Review' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region).queryByText('No cards')).toBeNull();
  });

  it('shows "n / limit" within the WIP limit without the danger styling', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 3 }), 3);

    const region = screen.getByRole('region', { name: 'Review' });
    expect(screen.getByLabelText('WIP 3 of 3')).toHaveTextContent('3 / 3');
    expect(region).not.toHaveAttribute('data-wip-exceeded');
    expect(within(region).getByTestId('card-list')).not.toHaveClass('bg-danger-subtle');
    expect(within(region).getByTestId('category-line')).not.toHaveClass('bg-danger');
  });

  it('highlights an exceeded WIP limit on the counter and the column', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 2 }), 3);

    const region = screen.getByRole('region', { name: 'Review' });
    const counter = screen.getByLabelText('WIP 3 of 2, limit exceeded');
    expect(counter).toHaveTextContent('3 / 2');
    expect(counter).toHaveClass('text-destructive');
    expect(region).toHaveAttribute('data-wip-exceeded', 'true');
    expect(within(region).getByTestId('category-line')).toHaveClass('bg-danger');
    expect(within(region).getByTestId('card-list')).toHaveClass('bg-danger-subtle', 'rounded-lg');
  });

  it('counts all cards even when the filter hides some of them', () => {
    const cards = cardsIn('col-a', 3);
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 2 }), 3, {
      cards,
      visibleCards: [],
    });

    expect(screen.getByLabelText('WIP 3 of 2, limit exceeded')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^SB-/ })).toHaveLength(0);
    expect(screen.getByText('No cards')).toBeInTheDocument();
  });

  it('marks a strict WIP limit and announces the category', () => {
    renderColumn(
      columnWith({
        id: 'col-a',
        title: 'Review',
        rank: 'a',
        category: 'IN_PROGRESS',
        wipLimit: 2,
        wipStrict: true,
      }),
      0,
    );

    expect(screen.getByRole('img', { name: 'Strict WIP limit' })).toHaveAttribute(
      'title',
      'Strict WIP limit',
    );
    expect(screen.getByTitle('Category: In progress')).toHaveTextContent('Category: In progress');
  });

  it('refuses quick creation in a full column with a strict limit, with the reason', () => {
    const error = vi.spyOn(toast, 'error');
    const column = columnWith({
      id: 'col-a',
      title: 'Review',
      rank: 'a',
      wipLimit: 2,
      wipStrict: true,
    });
    const { rerender } = renderColumn(column, 2, { canWriteCards: true });

    fireEvent.click(screen.getByRole('button', { name: 'Add a card to Review' }));

    expect(error).toHaveBeenCalledWith(
      'Column "Review" is at its WIP limit (2). Move a card out first.',
      expect.anything(),
    );
    expect(screen.queryByRole('form', { name: 'Add a card to Review' })).toBeNull();

    // With room left (or a non-strict limit) the composer opens.
    rerender(
      withDragContext(
        <BoardColumn
          column={{ ...column, wipLimit: 3 }}
          cards={cardsIn('col-a', 2)}
          canWrite={false}
          canEditSettings={false}
          canWriteCards
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a card to Review' }));
    expect(screen.getByRole('form', { name: 'Add a card to Review' })).toBeInTheDocument();
  });

  it('highlights the column as soon as a lowered limit is exceeded', () => {
    const column = columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 3 });
    const { rerender } = renderColumn(column, 2);
    expect(screen.getByRole('region', { name: 'Review' })).not.toHaveAttribute('data-wip-exceeded');

    rerender(
      withDragContext(
        <BoardColumn
          column={{ ...column, wipLimit: 1 }}
          cards={cardsIn('col-a', 2)}
          canWrite={false}
          canEditSettings={false}
        />,
      ),
    );

    expect(screen.getByRole('region', { name: 'Review' })).toHaveAttribute('data-wip-exceeded');
    expect(screen.getByLabelText('WIP 2 of 1, limit exceeded')).toHaveClass('text-destructive');
  });

  it('shows the empty state and no actions without permissions', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 0);

    expect(screen.getByText('No cards')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /^Cards in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Drag column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a card to Review' })).toBeNull();
  });

  it('shows skeleton cards instead of the empty state while the cards load', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 0, {
      isLoadingCards: true,
    });

    expect(screen.getAllByTestId('card-skeleton')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading cards...');
    expect(screen.queryByText('No cards')).toBeNull();
  });

  it('offers quick add and card drag handles with card:write', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 2, {
      canWriteCards: true,
      isCardDragDisabled: false,
    });

    expect(screen.getByRole('button', { name: 'Add a card to Review' })).toBeEnabled();
    for (const tile of screen.getAllByRole('button', { name: /^SB-/ })) {
      expect(tile).toHaveAttribute('data-rfd-drag-handle-draggable-id');
    }
  });

  it('keeps card tiles openable but not draggable while dragging is disabled', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 1, {
      canWriteCards: true,
      isCardDragDisabled: true,
    });

    const tile = screen.getByRole('button', { name: /^SB-1 Card 1/ });
    expect(tile).not.toHaveAttribute('data-rfd-drag-handle-draggable-id');
    expect(tile).toHaveAttribute('tabindex', '0');
  });

  it.each([
    ['BACKLOG', 'bg-cat-backlog', 'Backlog'],
    ['TODO', 'bg-cat-todo', 'To do'],
    ['IN_PROGRESS', 'bg-cat-progress', 'In progress'],
    ['DONE', 'bg-cat-done', 'Done'],
  ] as const)('draws the %s category line under the header', (category, lineClass, label) => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', category }), 1);

    const line = screen.getByTestId('category-line');
    expect(line).toHaveClass('h-0.5', lineClass);
    expect(line).toHaveAttribute('title', `Category: ${label}`);
    expect(line).toHaveTextContent(`Category: ${label}`);
    // The category is told by the line alone: no separate dot.
    expect(document.querySelector('[data-category]')).toBe(line);
  });

  it('shows a 12 px lock next to the counter only for a strict limit', () => {
    const { rerender } = renderColumn(
      columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 2, wipStrict: true }),
      1,
    );

    const lock = screen.getByRole('img', { name: 'Strict WIP limit' });
    expect(lock.querySelector('svg')).toHaveClass('size-3');
    expect(lock.previousElementSibling).toHaveAccessibleName('WIP 1 of 2');

    rerender(
      withDragContext(
        <BoardColumn
          column={columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 2 })}
          cards={cardsIn('col-a', 1)}
          canWrite={false}
          canEditSettings={false}
        />,
      ),
    );
    expect(screen.queryByRole('img', { name: 'Strict WIP limit' })).toBeNull();
  });

  it('shows the uppercase monospace name and a dashed empty state', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 0);

    expect(screen.getByRole('heading', { level: 2, name: 'Review' })).toHaveClass(
      'font-mono',
      'uppercase',
      'text-subtle',
    );
    expect(screen.getByText('No cards')).toHaveClass(
      'h-[72px]',
      'border-dashed',
      'font-mono',
      'text-muted',
    );
  });

  it('keeps the drag handle in the tab order and visible while it has the focus', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 0, {
      canWrite: true,
      dragHandleProps,
    });

    const handle = screen.getByRole('button', { name: 'Drag column Review' });
    expect(handle).toHaveAttribute('tabindex', '0');
    // Transparent while idle, but never removed from layout or the accessibility tree.
    expect(handle).toHaveClass(
      'opacity-0',
      'group-hover/column:opacity-100',
      'focus-visible:opacity-100',
    );
    expect(handle).not.toHaveClass('hidden', 'invisible');
    handle.focus();
    expect(handle).toHaveFocus();
  });

  it('lets the board open the composer through the composer handle', () => {
    const handle: { current: ColumnComposerHandle | null } = { current: null };
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 1, {
      canWriteCards: true,
      composerRef: handle,
    });

    act(() => handle.current?.openComposer());
    const title = screen.getByRole('textbox', { name: 'Card title' });
    expect(title).toHaveFocus();

    // An open composer is focused again, not closed (its draft is kept).
    fireEvent.change(title, { target: { value: 'Draft' } });
    screen.getByRole('button', { name: 'Add a card to Review' }).focus();
    act(() => handle.current?.openComposer());
    expect(screen.getByRole('textbox', { name: 'Card title' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Card title' })).toHaveValue('Draft');
  });

  it('refuses the composer handle in a full column with a strict limit, like "+"', () => {
    const error = vi.spyOn(toast, 'error');
    const handle: { current: ColumnComposerHandle | null } = { current: null };
    renderColumn(
      columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 1, wipStrict: true }),
      1,
      { canWriteCards: true, composerRef: handle },
    );

    act(() => handle.current?.openComposer());

    expect(error).toHaveBeenCalledWith(
      'Column "Review" is at its WIP limit (1). Move a card out first.',
      expect.anything(),
    );
    expect(screen.queryByRole('form', { name: 'Add a card to Review' })).toBeNull();
  });
});
