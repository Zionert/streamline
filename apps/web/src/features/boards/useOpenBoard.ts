import { useEffect } from 'react';

import { useBoardStore } from '@/stores/board';

/**
 * Opens the board `boardId` in the board store. A board that is already open (e.g. when switching
 * between its Board and Flow pages, or coming back to it) stays on screen instead of blanking the
 * top bar while it reloads, and is refreshed in the background: the snapshot may be old, and the
 * live updates refresh it only once their socket has joined the board's room.
 */
export function useOpenBoard(boardId: string): void {
  const openBoard = useBoardStore((state) => state.openBoard);
  useEffect(() => {
    const store = useBoardStore.getState();
    if (store.boardId === boardId && store.boardStatus === 'loading') {
      return;
    }
    if (store.boardId !== boardId || store.boardStatus !== 'ready') {
      void openBoard(boardId);
      return;
    }
    void store.resyncBoard(boardId).then((result) => {
      // Gone or no longer a member: loading it again shows "Board not found".
      if (result === 'access-lost' && useBoardStore.getState().boardId === boardId) {
        void openBoard(boardId);
      }
    });
  }, [boardId, openBoard]);
}
