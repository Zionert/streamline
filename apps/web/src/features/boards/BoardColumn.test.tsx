import { DragDropContext, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type { Card, Column } from '@streamline/shared';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { cardWith, columnWith } from '@/test/fixtures';

import { BoardColumn, type BoardColumnProps } from './BoardColumn';

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

  it('counts the real cards: "(n)" without a limit', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 2);

    const region = screen.getByRole('region', { name: 'Review' });
    expect(region).toHaveTextContent('(2)');
    expect(region).not.toHaveAttribute('data-wip-exceeded');
    const list = within(region).getByRole('list', { name: 'Cards in Review' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region).queryByText('No cards')).toBeNull();
  });

  it('shows "(n / limit)" within the WIP limit without the danger styling', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 3 }), 3);

    const region = screen.getByRole('region', { name: 'Review' });
    expect(screen.getByLabelText('WIP 3 of 3')).toHaveTextContent('(3 / 3)');
    expect(region).not.toHaveAttribute('data-wip-exceeded');
    expect(region).not.toHaveClass('bg-danger-subtle');
  });

  it('highlights an exceeded WIP limit on the counter and the column', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a', wipLimit: 2 }), 3);

    const region = screen.getByRole('region', { name: 'Review' });
    const counter = screen.getByLabelText('WIP 3 of 2, limit exceeded');
    expect(counter).toHaveTextContent('(3 / 2)');
    expect(counter).toHaveClass('text-destructive');
    expect(region).toHaveAttribute('data-wip-exceeded', 'true');
    expect(region).toHaveClass('border-danger', 'bg-danger-subtle');
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

    expect(screen.getByTitle('Strict WIP limit')).toBeInTheDocument();
    expect(screen.getByTitle('Category: In progress')).toHaveTextContent('Category: In progress');
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
});
