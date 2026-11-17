import type { Board } from '@streamline/shared';
import { useMatch } from 'react-router';

import { useBoardStore } from '@/stores/board';

import { BOARD_PATH_PATTERN } from './paths';

/**
 * The board opened on the current page (including the card details subroute), once it has
 * loaded; `null` elsewhere. The top bar sits above the board route, so it matches the URL itself.
 */
export function useCurrentBoard(): Board | null {
  const match = useMatch({ path: BOARD_PATH_PATTERN, end: false });
  const routeBoardId = match?.params.boardId;
  const board = useBoardStore((state) => state.board);
  const status = useBoardStore((state) => state.boardStatus);
  if (!routeBoardId || status !== 'ready' || !board || board.id !== routeBoardId) {
    return null;
  }
  return board;
}
