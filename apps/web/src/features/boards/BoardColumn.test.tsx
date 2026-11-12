import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import type { Column } from '@streamline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { columnWith } from '@/test/fixtures';

import { BoardColumn } from './BoardColumn';

function renderColumn(column: Column, cardCount: number) {
  return render(
    <BoardColumn column={column} cardCount={cardCount} canWrite={false} canEditSettings={false} />,
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
      <BoardColumn
        column={columnWith({
          id: 'col-a',
          title: 'Review',
          rank: 'a',
          wipLimit: 1,
          wipStrict: true,
        })}
        cardCount={2}
        canWrite
        canEditSettings={false}
        dragHandleProps={dragHandleProps}
      />,
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

  it('shows the counter without a limit as "(n)"', () => {
    renderColumn(columnWith({ id: 'col-a', title: 'Review', rank: 'a' }), 2);

    const region = screen.getByRole('region', { name: 'Review' });
    expect(region).toHaveTextContent('(2)');
    expect(region).not.toHaveAttribute('data-wip-exceeded');
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
    expect(screen.queryByRole('button', { name: /^Actions for column/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Drag column/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a card to Review' })).toBeDisabled();
  });
});
