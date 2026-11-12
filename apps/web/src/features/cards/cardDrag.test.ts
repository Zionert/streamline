import type { DropResult } from '@hello-pangea/dnd';
import { describe, expect, it } from 'vitest';

import { COLUMNS_DROPPABLE_ID } from '@/features/boards/columnDrag';

import { CARD_DRAG_TYPE, cardsDroppableId, columnIdOfDroppable, getCardMove } from './cardDrag';

function drop(overrides: Partial<DropResult>): DropResult {
  return {
    draggableId: 'card-1',
    type: CARD_DRAG_TYPE,
    source: { droppableId: cardsDroppableId('col-a'), index: 0 },
    destination: { droppableId: cardsDroppableId('col-b'), index: 2 },
    reason: 'DROP',
    mode: 'FLUID',
    combine: null,
    ...overrides,
  };
}

describe('card droppable ids', () => {
  it('round-trips the column id', () => {
    expect(columnIdOfDroppable(cardsDroppableId('col-a'))).toBe('col-a');
    expect(columnIdOfDroppable(COLUMNS_DROPPABLE_ID)).toBeNull();
  });
});

describe('getCardMove', () => {
  it('describes a move to another column', () => {
    expect(getCardMove(drop({}))).toEqual({ cardId: 'card-1', toColumnId: 'col-b', toIndex: 2 });
  });

  it('describes a reorder within the column', () => {
    expect(
      getCardMove(drop({ destination: { droppableId: cardsDroppableId('col-a'), index: 3 } })),
    ).toEqual({ cardId: 'card-1', toColumnId: 'col-a', toIndex: 3 });
  });

  it('ignores drops in place, outside a list, cancelled drags and column drags', () => {
    expect(
      getCardMove(drop({ destination: { droppableId: cardsDroppableId('col-a'), index: 0 } })),
    ).toBeNull();
    expect(getCardMove(drop({ destination: null }))).toBeNull();
    expect(getCardMove(drop({ reason: 'CANCEL' }))).toBeNull();
    expect(
      getCardMove(
        drop({ type: 'COLUMN', destination: { droppableId: COLUMNS_DROPPABLE_ID, index: 1 } }),
      ),
    ).toBeNull();
  });
});
