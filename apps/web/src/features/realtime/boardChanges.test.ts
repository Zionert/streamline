import { describe, expect, it, vi } from 'vitest';

import { publishBoardChange, subscribeBoardChanges, type BoardChange } from './boardChanges';

const rejoined: BoardChange = { type: 'rejoined' };

describe('board changes', () => {
  it('notifies the subscribers of the board only, until they unsubscribe', () => {
    const first = vi.fn<(change: BoardChange) => void>();
    const other = vi.fn<(change: BoardChange) => void>();
    const unsubscribe = subscribeBoardChanges('board-1', first);
    const unsubscribeOther = subscribeBoardChanges('board-2', other);

    publishBoardChange('board-1', rejoined);
    expect(first).toHaveBeenCalledWith(rejoined);
    expect(other).not.toHaveBeenCalled();

    unsubscribe();
    publishBoardChange('board-1', { type: 'local', kind: 'card-moved' });
    expect(first).toHaveBeenCalledTimes(1);
    unsubscribeOther();
  });

  it('lets a subscriber unsubscribe while being notified', () => {
    const calls: string[] = [];
    const unsubscribeA = subscribeBoardChanges('board-1', () => {
      calls.push('a');
      unsubscribeA();
    });
    const unsubscribeB = subscribeBoardChanges('board-1', () => calls.push('b'));

    publishBoardChange('board-1', rejoined);
    publishBoardChange('board-1', rejoined);

    expect(calls).toEqual(['a', 'b', 'b']);
    unsubscribeB();
  });
});
