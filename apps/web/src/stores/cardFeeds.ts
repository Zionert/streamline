import { useBoardActivityStore, useCardActivityStore } from './activity';
import { useCommentsStore } from './comments';

/** The feeds shown next to a board: comments and activity of a card, the board's activity. */
const feeds = [useCommentsStore, useBoardActivityStore, useCardActivityStore] as const;

/** Drops the feeds of boards other than `boardId` (all of them for `null`). */
export function resetFeedsExcept(boardId: string | null): void {
  for (const feed of feeds) {
    const { scope, reset } = feed.getState();
    if (scope !== null && scope.boardId !== boardId) {
      reset();
    }
  }
}

/** Loads the open feeds of the board again (e.g. after live events may have been missed). */
export function reloadFeeds(boardId: string): Promise<void> {
  return Promise.all(
    feeds.map((feed) => {
      const { scope, reload } = feed.getState();
      return scope !== null && scope.boardId === boardId ? reload() : Promise.resolve();
    }),
  ).then(() => undefined);
}
