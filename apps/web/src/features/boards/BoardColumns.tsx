import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import type { Card, Column } from '@streamline/shared';

import type { AvatarStackPerson } from '@/components/ui/avatar';
import { getCardMove } from '@/features/cards/cardDrag';
import {
  filterCards,
  isFilterActive,
  matchesFilter,
  type CardFilter,
} from '@/features/cards/cardFilter';
import { cardsOf, type CardsByColumn } from '@/features/cards/cardOrder';

import { BoardColumn } from './BoardColumn';
import { COLUMNS_DROPPABLE_ID, getColumnMove } from './columnDrag';

export interface BoardColumnsProps {
  columns: readonly Column[];
  canWrite: boolean;
  canEditSettings: boolean;
  /** Dragging columns is paused while a previous column move is being saved. */
  isMoving: boolean;
  onMove: (columnId: string, toIndex: number) => void;
  cardsByColumn: CardsByColumn;
  /** View-only filter of the toolbar; counters keep showing all cards. */
  filter: CardFilter;
  isLoadingCards: boolean;
  /** Create, edit and move cards (`card:write`). */
  canWriteCards: boolean;
  /** Cards cannot be dragged (a move being saved, or an active filter). */
  isCardDragDisabled: boolean;
  membersById: ReadonlyMap<string, AvatarStackPerson>;
  onMoveCard: (cardId: string, toColumnId: string, toIndex: number) => void;
  onOpenCard: (card: Card) => void;
}

/**
 * Columns laid out horizontally, each with its cards. Columns (type `COLUMN`) and cards (type
 * `CARD`, nested droppables) share one drag context; members with the permissions can drag both.
 */
export function BoardColumns({
  columns,
  canWrite,
  canEditSettings,
  isMoving,
  onMove,
  cardsByColumn,
  filter,
  isLoadingCards,
  canWriteCards,
  isCardDragDisabled,
  membersById,
  onMoveCard,
  onOpenCard,
}: BoardColumnsProps) {
  const isCardHidden = isFilterActive(filter)
    ? (card: Card) => !matchesFilter(card, filter)
    : undefined;

  const handleDragEnd = (result: DropResult) => {
    const columnMove = getColumnMove(result);
    if (columnMove) {
      onMove(columnMove.columnId, columnMove.toIndex);
      return;
    }
    const cardMove = getCardMove(result);
    if (cardMove) {
      onMoveCard(cardMove.cardId, cardMove.toColumnId, cardMove.toIndex);
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
            {columns.map((column, index) => {
              const cards = cardsOf(cardsByColumn, column.id);
              return (
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
                        cards={cards}
                        visibleCards={filterCards(cards, filter)}
                        isLoadingCards={isLoadingCards}
                        canWrite={canWrite}
                        canEditSettings={canEditSettings}
                        canWriteCards={canWriteCards}
                        isCardDragDisabled={isCardDragDisabled}
                        membersById={membersById}
                        onOpenCard={onOpenCard}
                        isCardHidden={isCardHidden}
                        dragHandleProps={canWrite ? draggableProvided.dragHandleProps : null}
                        isDragging={snapshot.isDragging}
                      />
                    </div>
                  )}
                </Draggable>
              );
            })}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
