import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import { errorBody } from '@/test/mockAdapter';

import { getBoardErrorMessage, isNotFoundError, isStaleColumnsError } from './boardErrorMessage';

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    data,
    headers: new AxiosHeaders(),
    config,
  });
}

describe('getBoardErrorMessage', () => {
  it.each([
    [404, 'USER_NOT_FOUND', /no registered user/i],
    [409, 'ALREADY_MEMBER', /already a member/i],
    [409, 'OWNER_CANNOT_LEAVE', /owner cannot leave/i],
    [409, 'LAST_DONE_COLUMN', /at least one Done column/i],
    [503, 'BOARD_BUSY', /try again/i],
    [409, 'INVALID_POSITION', /refreshed/i],
    [403, 'FORBIDDEN', /permission/i],
  ])('explains %i %s', (status, code, expected) => {
    expect(getBoardErrorMessage(httpError(status, errorBody(code, 'raw')))).toMatch(expected);
  });

  it('shows the server message of a validation error', () => {
    expect(
      getBoardErrorMessage(httpError(400, errorBody('VALIDATION_ERROR', 'Name is too long'))),
    ).toBe('Name is too long');
  });

  it('reports a network error', () => {
    expect(getBoardErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK', config))).toMatch(
      /unable to reach/i,
    );
  });

  it('falls back to a generic message', () => {
    expect(getBoardErrorMessage(httpError(500, errorBody('INTERNAL_ERROR')))).toMatch(
      /something went wrong/i,
    );
    expect(getBoardErrorMessage(new Error('boom'))).toMatch(/something went wrong/i);
  });
});

describe('error classification', () => {
  it('treats INVALID_POSITION and NEIGHBOR_NOT_FOUND as a stale view', () => {
    expect(isStaleColumnsError(httpError(409, errorBody('INVALID_POSITION')))).toBe(true);
    expect(isStaleColumnsError(httpError(404, errorBody('NEIGHBOR_NOT_FOUND')))).toBe(true);
    expect(isStaleColumnsError(httpError(409, errorBody('RANK_CONFLICT')))).toBe(false);
  });

  it('detects 404 responses', () => {
    expect(isNotFoundError(httpError(404, errorBody('NOT_FOUND')))).toBe(true);
    expect(isNotFoundError(httpError(403, errorBody('FORBIDDEN')))).toBe(false);
  });
});
