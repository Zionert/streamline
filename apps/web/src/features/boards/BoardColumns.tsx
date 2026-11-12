import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import type { Column } from '@streamline/shared';

import { BoardColumn } from './BoardColumn';
import { COLUMNS_DROPPABLE_ID, getColumnMove } from './columnDrag';

const NO_CARDS = () => 0;

export interface BoardColumnsProps {
  columns: readonly Column[];
  canWrite: boolean;
  canEditSettings: boolean;
  /** Dragging is paused while a previous move is being saved. */
  isMoving: boolean;
  onMove: (columnId: string, toIndex: number) => void;
  /** Number of cards per column, for the WIP counters (no cards exist yet). */
  getCardCount?: (columnId: string) => number;
}

/** Columns laid out horizontally; members with `column:write` can reorder them by dragging. */
export function BoardColumns({
  columns,
  canWrite,
  canEditSettings,
  isMoving,
  onMove,
  getCardCount = NO_CARDS,
}: BoardColumnsProps) {
  const handleDragEnd = (result: DropResult) => {
    const move = getColumnMove(result);
    if (move) {
      onMove(move.columnId, move.toIndex);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId={COLUMNS_DROPPABLE_ID} direction="horizontal" type="COLUMN">
        {(droppableProvided) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            aria-label="Columns"
            role="list"
            className="flex h-full items-stretch gap-3"
          >
            {columns.map((column, index) => (
              <Draggable
                key={column.id}
                draggableId={column.id}
                index={index}
                isDragDisabled={!canWrite || isMoving}
              >
                {(draggableProvided, snapshot) => (
                  <div
                    ref={draggableProvided.innerRef}
                    {...draggableProvided.draggableProps}
                    role="listitem"
                    className="h-full"
                  >
                    <BoardColumn
                      column={column}
                      cardCount={getCardCount(column.id)}
                      canWrite={canWrite}
                      canEditSettings={canEditSettings}
                      dragHandleProps={canWrite ? draggableProvided.dragHandleProps : null}
                      isDragging={snapshot.isDragging}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
