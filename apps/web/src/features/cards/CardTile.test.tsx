import type { Label } from '@streamline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cardWith, labelWith } from '@/test/fixtures';

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

const labels: Label[] = [
  labelWith({ id: 'l1', name: 'Backend', color: 'BLUE' }),
  labelWith({ id: 'l2', name: 'Design', color: 'PINK' }),
];

describe('CardTile', () => {
  it('shows the title clamped to two lines, the key, the priority and the assignee', () => {
    render(<CardTile card={card} assignee={jan} onOpen={() => undefined} />);

    const tile = screen.getByRole('button', {
      name: `SB-12 ${card.title}, priority High, assigned to Jan Kowalski`,
    });
    expect(within(tile).getByTestId('card-title')).toHaveClass(
      'line-clamp-2',
      'text-sm',
      'font-medium',
    );
    expect(within(tile).getByText('SB-12')).toHaveClass('font-mono', 'text-xs', 'text-subtle');
    expect(within(tile).getByRole('img', { name: 'Jan Kowalski' })).toHaveClass('size-[22px]');
    expect(tile).toHaveClass(
      'bg-surface',
      'border',
      'border-border',
      'rounded-lg',
      'p-3',
      'shadow-card',
      'hover:border-border-strong',
      'focus-visible:ring-2',
      'focus-visible:ring-ring',
      'focus-visible:ring-offset-2',
    );
  });

  it('shows labels as a coloured dot and the name, without pills', () => {
    render(<CardTile card={card} assignee={null} labels={labels} onOpen={() => undefined} />);

    const tile = screen.getByRole('button');
    expect(tile).toHaveAccessibleName(/, labels Backend, Design$/);
    const shown = within(tile).getAllByTestId('card-label');
    expect(shown.map((label) => label.textContent)).toEqual(['Backend', 'Design']);
    const dot = shown[0]?.querySelector('[data-label-color]');
    expect(dot).toHaveAttribute('data-label-color', 'BLUE');
    expect(dot).toHaveClass('size-[7px]', 'rounded-full');
    expect(dot?.getAttribute('style')).toContain('var(--label-blue-dot)');
    expect(shown[0]).toHaveClass('text-xs', 'text-subtle');
  });

  it('marks HIGH with a flag and its name in the warning colour', () => {
    render(<CardTile card={card} assignee={null} onOpen={() => undefined} />);

    const marker = screen.getByTitle('Priority: High');
    expect(marker).toHaveAttribute('data-priority', 'HIGH');
    expect(marker).toHaveClass('text-warning-text');
    expect(marker).toHaveTextContent('High');
    expect(marker.querySelectorAll('svg')).toHaveLength(1);
    expect(marker.querySelector('svg')).toHaveClass('size-3.5');
  });

  it('marks URGENT with chevrons in the error colour and has no avatar when unassigned', () => {
    const { container } = render(
      <CardTile
        card={{ ...card, priority: 'URGENT', assigneeId: null }}
        assignee={null}
        onOpen={() => undefined}
      />,
    );

    const marker = screen.getByTitle('Priority: Urgent');
    expect(marker).toHaveClass('text-destructive');
    expect(marker).toHaveTextContent('Urgent');
    expect(marker.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.getByRole('button')).toHaveAccessibleName(/, unassigned$/);
    expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
  });

  it.each(['LOW', 'MEDIUM'] as const)(
    'shows no marker for %s, but still announces it',
    (priority) => {
      const { container } = render(
        <CardTile card={{ ...card, priority }} assignee={null} onOpen={() => undefined} />,
      );

      expect(container.querySelector('[data-priority]')).toBeNull();
      expect(screen.queryByTitle(/^Priority:/)).toBeNull();
      const name = priority === 'LOW' ? 'Low' : 'Medium';
      expect(screen.getByRole('button')).toHaveAccessibleName(
        new RegExp(`, priority ${name}, unassigned$`),
      );
    },
  );

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
    expect(screen.getByRole('button')).toHaveClass('rotate-1', 'border-primary', 'shadow-raised');
  });
});
