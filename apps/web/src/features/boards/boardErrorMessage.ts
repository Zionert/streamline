import { BOARD_ERROR_CODES, CARD_ERROR_CODES, COLUMN_ERROR_CODES } from '@streamline/shared';
import { isAxiosError } from 'axios';

import { getApiErrorInfo } from '@/lib/api-error';

const NETWORK_ERROR = 'Unable to reach the server. Please try again.';
const UNKNOWN_ERROR = 'Something went wrong. Please try again.';

/** Messages for domain error codes of the board, member, column and card endpoints. */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  [BOARD_ERROR_CODES.USER_NOT_FOUND]: 'No registered user has this email address.',
  [BOARD_ERROR_CODES.ALREADY_MEMBER]: 'This user is already a member of the board.',
  [BOARD_ERROR_CODES.OWNER_CANNOT_LEAVE]: 'The owner cannot leave the board.',
  [COLUMN_ERROR_CODES.LAST_DONE_COLUMN]:
    'A board needs at least one Done column. Mark another column as Done first.',
  [COLUMN_ERROR_CODES.BOARD_BUSY]: 'The board is busy right now. Please try again in a moment.',
  [COLUMN_ERROR_CODES.RANK_CONFLICT]: 'Too many simultaneous changes. Please try again.',
  [COLUMN_ERROR_CODES.INVALID_POSITION]:
    'The board was changed in the meantime. The columns have been refreshed.',
  [COLUMN_ERROR_CODES.NEIGHBOR_NOT_FOUND]:
    'The board was changed in the meantime. The columns have been refreshed.',
  [COLUMN_ERROR_CODES.COLUMN_NOT_EMPTY]: 'Move or delete the cards in this column first.',
  [CARD_ERROR_CODES.WIP_LIMIT_EXCEEDED]: 'This column has reached its WIP limit.',
  [CARD_ERROR_CODES.ASSIGNEE_NOT_MEMBER]: 'The assignee must be a member of this board.',
  FORBIDDEN: 'You do not have permission to do this.',
  NOT_FOUND: 'It no longer exists. It may have been deleted.',
};

/** User-facing message for a failed board, member or column request. */
export function getBoardErrorMessage(error: unknown): string {
  if (isAxiosError(error) && !error.response) {
    return NETWORK_ERROR;
  }
  const { status, code, message } = getApiErrorInfo(error);
  const known = code === undefined ? undefined : CODE_MESSAGES[code];
  if (known) {
    return known;
  }
  // Validation errors carry a message meant for the user.
  if (status === 400 && message) {
    return message;
  }
  if (status === 429) {
    return 'Too many requests. Please try again later.';
  }
  return UNKNOWN_ERROR;
}

/** Whether the request failed because the client's view of the column order is stale. */
export function isStaleColumnsError(error: unknown): boolean {
  const { code } = getApiErrorInfo(error);
  return (
    code === COLUMN_ERROR_CODES.INVALID_POSITION || code === COLUMN_ERROR_CODES.NEIGHBOR_NOT_FOUND
  );
}

export function isNotFoundError(error: unknown): boolean {
  return getApiErrorInfo(error).status === 404;
}

/** The board is gone or the user is no longer a member (404), or lost the right to see it (403). */
export function isAccessLostError(error: unknown): boolean {
  const { status } = getApiErrorInfo(error);
  return status === 404 || status === 403;
}
