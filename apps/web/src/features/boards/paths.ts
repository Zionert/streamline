export const BOARDS_PATH = '/boards';

export const BOARD_PATH_PATTERN = `${BOARDS_PATH}/:boardId`;

export function boardPath(boardId: string): string {
  return `${BOARDS_PATH}/${encodeURIComponent(boardId)}`;
}
