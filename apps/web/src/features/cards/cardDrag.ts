import type { DropResult } from '@hello-pangea/dnd';

/** Drag & drop type of cards; distinct from the columns' type, so the two never mix. */
export const CARD_DRAG_TYPE = 'CARD';

const CARDS_DROPPABLE_PREFIX = 'cards:';

/** Id of the droppable card list of a column. */
export function cardsDroppableId(columnId: string): string {
  return `${CARDS_DROPPABLE_PREFIX}${columnId}`;
}

/** The column of a card list droppable, or `null` for any other droppable. */
export function columnIdOfDroppable(droppableId: string): string | null {
  return droppableId.startsWith(CARDS_DROPPABLE_PREFIX)
    ? droppableId.slice(CARDS_DROPPABLE_PREFIX.length)
    : null;
}

export interface CardMove {
  cardId: string;
  toColumnId: string;
  /** Index in the target column after the move. */
  toIndex: number;
}

/** The card move described by a finished drag, or `null` when nothing has to change. */
export function getCardMove(result: DropResult): CardMove | null {
  const { destination, source, draggableId, reason, type } = result;
  if (reason !== 'DROP' || type !== CARD_DRAG_TYPE || !destination) {
    return null;
  }
  const toColumnId = columnIdOfDroppable(destination.droppableId);
  if (toColumnId === null) {
    return null;
  }
  if (destination.droppableId === source.droppableId && destination.index === source.index) {
    return null;
  }
  return { cardId: draggableId, toColumnId, toIndex: destination.index };
}
