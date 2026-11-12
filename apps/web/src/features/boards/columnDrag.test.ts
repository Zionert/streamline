import type { DropResult } from '@hello-pangea/dnd';
import { describe, expect, it } from 'vitest';

import { COLUMNS_DROPPABLE_ID, getColumnMove } from './columnDrag';

function dropResult(overrides: Partial<DropResult> = {}): DropResult {
  return {
    draggableId: 'col-1',
    type: 'COLUMN',
    mode: 'FLUID',
    reason: 'DROP',
    source: { droppableId: COLUMNS_DROPPABLE_ID, index: 0 },
    destination: { droppableId: COLUMNS_DROPPABLE_ID, index: 2 },
    combine: null,
    ...overrides,
  };
}

describe('getColumnMove', () => {
  it('returns the dragged column and its destination index', () => {
    expect(getColumnMove(dropResult())).toEqual({ columnId: 'col-1', toIndex: 2 });
  });

  it('ignores a cancelled drag', () => {
    expect(getColumnMove(dropResult({ reason: 'CANCEL' }))).toBeNull();
  });

  it('ignores a drop outside the list', () => {
    expect(getColumnMove(dropResult({ destination: null }))).toBeNull();
  });

  it('ignores a drop on another droppable', () => {
    expect(
      getColumnMove(dropResult({ destination: { droppableId: 'other', index: 1 } })),
    ).toBeNull();
  });

  it('ignores a drop at the original position', () => {
    expect(
      getColumnMove(dropResult({ destination: { droppableId: COLUMNS_DROPPABLE_ID, index: 0 } })),
    ).toBeNull();
  });
});
