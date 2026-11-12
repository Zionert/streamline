import { CARD_ERROR_CODES } from '@streamline/shared';

import { getBoardErrorMessage } from '@/features/boards/boardErrorMessage';
import { getApiErrorInfo } from '@/lib/api-error';

const STALE_CARDS = 'The board was changed in the meantime. The cards have been refreshed.';

/** Messages that differ from the board ones when the failed request was about a card. */
const CARD_CODE_MESSAGES: Readonly<Record<string, string>> = {
  [CARD_ERROR_CODES.INVALID_POSITION]: STALE_CARDS,
  [CARD_ERROR_CODES.NEIGHBOR_NOT_FOUND]: STALE_CARDS,
  [CARD_ERROR_CODES.COLUMN_NOT_FOUND]:
    'This column no longer exists. The board has been refreshed.',
  NOT_FOUND: 'This card no longer exists. It may have been deleted.',
};

/** User-facing message for a failed card request. */
export function getCardErrorMessage(error: unknown): string {
  const { code } = getApiErrorInfo(error);
  const known = code === undefined ? undefined : CARD_CODE_MESSAGES[code];
  return known ?? getBoardErrorMessage(error);
}

/**
 * Whether the client's view of the cards is outdated after a failed move: stale neighbours, a
 * missing card or column. The cards are then reloaded.
 */
export function needsCardsReload(error: unknown): boolean {
  const { status, code } = getApiErrorInfo(error);
  return status === 404 || code === CARD_ERROR_CODES.INVALID_POSITION;
}

/** Whether the target column of a card request was deleted elsewhere (the board is reloaded). */
export function isColumnGoneError(error: unknown): boolean {
  return getApiErrorInfo(error).code === CARD_ERROR_CODES.COLUMN_NOT_FOUND;
}
