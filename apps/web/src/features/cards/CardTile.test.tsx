import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cardWith } from '@/test/fixtures';

import { CardTile } from './CardTile';

const card = cardWith({
  id: 'c1',
  number: 12,
  columnId: 'A',
  rank: 'b',
  title: 'Fix the login page so that it no longer crashes on very long passwords',
  priority: 'HIGH',
  assigneeId: 'u1',
});
const jan = { userId: 'u1', name: 'Jan Kowalski' };

describe('CardTile', () => {
  it('shows the title clamped to two lines, the key, the priority and the assignee', () => {
    render(<CardTile card={card} assignee={jan} onOpen={() => undefined} />);

    const tile = screen.getByRole('button', {
      name: `SB-12 ${card.title}, priority High, assigned to Jan Kowalski`,
    });
    expect(within(tile).getByTestId('card-title')).toHaveClass('line-clamp-2', 'text-sm');
    expect(tile).toHaveTextContent('SB-12');
    expect(within(tile).getByTitle('Priority: High')).toHaveAttribute('data-priority', 'HIGH');
    expect(within(tile).getByRole('img', { name: 'Jan Kowalski' })).toHaveClass('size-6');
    expect(tile).toHaveClass('bg-surface', 'shadow-card', 'p-3', 'focus-visible:ring-primary');
  });

  it('marks URGENT with chevrons and has no avatar when unassigned', () => {
    const { container } = render(
      <CardTile
        card={{ ...card, priority: 'URGENT', assigneeId: null }}
        assignee={null}
        onOpen={() => undefined}
      />,
    );

    const flag = screen.getByTitle('Priority: Urgent');
    expect(flag.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByRole('button')).toHaveAccessibleName(/, unassigned$/);
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
  });

  it.each(['LOW', 'MEDIUM', 'HIGH'] as const)('shows a single flag for %s', (priority) => {
    render(<CardTile card={{ ...card, priority }} assignee={null} onOpen={() => undefined} />);

    const flag = screen.getByTitle(/^Priority:/);
    expect(flag).toHaveAttribute('data-priority', priority);
    expect(flag.querySelectorAll('svg')).toHaveLength(1);
  });

  it('opens on click, Enter and (when not draggable) Space', () => {
    const onOpen = vi.fn();
    render(<CardTile card={card} assignee={null} onOpen={onOpen} />);
    const tile = screen.getByRole('button');

    fireEvent.click(tile);
    fireEvent.keyDown(tile, { key: 'Enter' });
    fireEvent.keyDown(tile, { key: ' ' });

    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('leaves Space to the drag handle and ignores Enter while dragging', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <CardTile card={card} assignee={null} onOpen={onOpen} isDraggable />,
    );

    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onOpen).not.toHaveBeenCalled();

    rerender(<CardTile card={card} assignee={null} onOpen={onOpen} isDraggable isDragging />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveClass('rotate-2', 'shadow-raised');
  });
});
