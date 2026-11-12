import type { DropResult } from '@hello-pangea/dnd';

export const COLUMNS_DROPPABLE_ID = 'board-columns';

export interface ColumnMove {
  columnId: string;
  toIndex: number;
}

/** The column move described by a finished drag, or `null` when nothing has to change. */
export function getColumnMove(result: DropResult): ColumnMove | null {
  const { destination, source, draggableId, reason } = result;
  if (reason !== 'DROP' || !destination || destination.droppableId !== COLUMNS_DROPPABLE_ID) {
    return null;
  }
  if (destination.index === source.index) {
    return null;
  }
  return { columnId: draggableId, toIndex: destination.index };
}
