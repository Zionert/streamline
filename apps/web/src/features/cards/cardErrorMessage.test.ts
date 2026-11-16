import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import { getBoardErrorMessage } from '@/features/boards/boardErrorMessage';
import { errorBody } from '@/test/mockAdapter';

import {
  getCardErrorMessage,
  isColumnGoneError,
  needsCardsReload,
  wipLimitMessage,
} from './cardErrorMessage';

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

function httpError(status: number, code: string, details?: unknown): AxiosError {
  const body = errorBody(code, 'raw');
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    data: details === undefined ? body : { error: { ...body.error, details } },
    headers: new AxiosHeaders(),
    config,
  });
}

describe('card error messages', () => {
  it.each([
    [409, 'WIP_LIMIT_EXCEEDED', 'This column has reached its WIP limit.'],
    [400, 'ASSIGNEE_NOT_MEMBER', 'The assignee must be a member of this board.'],
    [409, 'COLUMN_NOT_EMPTY', 'Move or delete the cards in this column first.'],
  ])('explains %i %s on board and card requests', (status, code, expected) => {
    expect(getBoardErrorMessage(httpError(status, code))).toBe(expected);
    expect(getCardErrorMessage(httpError(status, code))).toBe(expected);
  });

  it('names the full column and its limit when the WIP error has details', () => {
    const error = httpError(409, 'WIP_LIMIT_EXCEEDED', {
      columnId: 'col-progress',
      columnName: 'In Progress',
      wipLimit: 3,
    });
    expect(getCardErrorMessage(error)).toBe(
      'Column "In Progress" is at its WIP limit (3). Move a card out first.',
    );
    expect(wipLimitMessage('Review', 1)).toBe(
      'Column "Review" is at its WIP limit (1). Move a card out first.',
    );
    // Malformed details fall back to the generic message.
    expect(getCardErrorMessage(httpError(409, 'WIP_LIMIT_EXCEEDED', { wipLimit: 'x' }))).toBe(
      'This column has reached its WIP limit.',
    );
  });

  it.each([
    [409, 'LABEL_NAME_TAKEN', /label with this name already exists/],
    [409, 'LABEL_LIMIT_REACHED', /at most 50 labels/],
    [409, 'CARD_LABEL_LIMIT_REACHED', /card can have at most 10 labels/],
    [404, 'LABEL_NOT_FOUND', /label no longer exists/],
    [404, 'COMMENT_NOT_FOUND', /comment no longer exists/],
    [403, 'COMMENT_FORBIDDEN', /only change your own comments/],
  ])('explains %i %s', (status, code, expected) => {
    expect(getCardErrorMessage(httpError(status, code))).toMatch(expected);
  });

  it('talks about cards (not columns) for a stale card view', () => {
    expect(getCardErrorMessage(httpError(409, 'INVALID_POSITION'))).toMatch(
      /cards have been refreshed/,
    );
    expect(getCardErrorMessage(httpError(404, 'NEIGHBOR_NOT_FOUND'))).toMatch(
      /cards have been refreshed/,
    );
    expect(getCardErrorMessage(httpError(404, 'NOT_FOUND'))).toMatch(/card no longer exists/);
  });

  it('falls back to the board messages', () => {
    expect(getCardErrorMessage(httpError(503, 'BOARD_BUSY'))).toMatch(/busy/);
    expect(getCardErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK', config))).toMatch(
      /unable to reach/i,
    );
  });

  it('asks for a reload after a stale view or a missing card or column', () => {
    expect(needsCardsReload(httpError(409, 'INVALID_POSITION'))).toBe(true);
    expect(needsCardsReload(httpError(404, 'NEIGHBOR_NOT_FOUND'))).toBe(true);
    expect(needsCardsReload(httpError(404, 'COLUMN_NOT_FOUND'))).toBe(true);
    expect(needsCardsReload(httpError(404, 'NOT_FOUND'))).toBe(true);
    expect(needsCardsReload(httpError(409, 'WIP_LIMIT_EXCEEDED'))).toBe(false);
    expect(needsCardsReload(httpError(503, 'BOARD_BUSY'))).toBe(false);
  });

  it('recognises a column deleted elsewhere and says the board was refreshed', () => {
    expect(isColumnGoneError(httpError(404, 'COLUMN_NOT_FOUND'))).toBe(true);
    expect(isColumnGoneError(httpError(404, 'NOT_FOUND'))).toBe(false);
    expect(getCardErrorMessage(httpError(404, 'COLUMN_NOT_FOUND'))).toBe(
      'This column no longer exists. The board has been refreshed.',
    );
  });
});
