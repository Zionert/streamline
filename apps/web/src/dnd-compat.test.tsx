import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { render, screen } from '@testing-library/react';
import { version as reactVersion } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Smoke test: @hello-pangea/dnd renders with the installed React version
 * without runtime errors or React warnings.
 */
describe('@hello-pangea/dnd compatibility', () => {
  it(`renders DragDropContext, Droppable and Draggable with React ${reactVersion}`, () => {
    const consoleError = vi.spyOn(console, 'error');
    const items = ['first', 'second'];

    render(
      <DragDropContext onDragEnd={() => undefined}>
        <Droppable droppableId="column-1">
          {(droppableProvided) => (
            <ul ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
              {items.map((item, index) => (
                <Draggable key={item} draggableId={item} index={index}>
                  {(draggableProvided) => (
                    <li
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      {...draggableProvided.dragHandleProps}
                    >
                      {item}
                    </li>
                  )}
                </Draggable>
              ))}
              {droppableProvided.placeholder}
            </ul>
          )}
        </Droppable>
      </DragDropContext>,
    );

    const handles = screen.getAllByRole('button');
    expect(handles.map((handle) => handle.textContent)).toEqual(items);
    expect(screen.getByText('first')).toHaveAttribute('data-rfd-draggable-id', 'first');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
