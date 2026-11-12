export const BOARDS_PATH = '/boards';

export const BOARD_PATH_PATTERN = `${BOARDS_PATH}/:boardId`;

export function boardPath(boardId: string): string {
  return `${BOARDS_PATH}/${encodeURIComponent(boardId)}`;
}

export const CARD_ROUTE_PATH = 'cards/:cardKey';

/** Address of the card details (a modal over the board), e.g. `/boards/b1/cards/SL-12`. */
export function cardPath(boardId: string, cardKey: string): string {
  return `${boardPath(boardId)}/cards/${encodeURIComponent(cardKey)}`;
}

/** Navigation state of a card opened from its board: closing it then goes back in history. */
export interface CardLocationState {
  fromBoard: true;
}

export function isOpenedFromBoard(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'fromBoard' in state && state.fromBoard === true
  );
}
