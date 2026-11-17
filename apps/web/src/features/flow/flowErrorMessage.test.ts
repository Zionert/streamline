import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { describe, expect, it } from 'vitest';

import { getFlowErrorMessage } from './flowErrorMessage';

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

function failure(status: number, data: unknown): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config,
    data,
  });
}

describe('getFlowErrorMessage', () => {
  it('shows the first validation issue of a 400', () => {
    const error = failure(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: [
          { code: 'custom', path: ['targetDate'], message: 'targetDate must be after today' },
        ],
      },
    });
    expect(getFlowErrorMessage(error)).toBe('targetDate must be after today');
  });

  it('has a generic message for a validation error without issues', () => {
    const error = failure(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid time zone' },
    });
    expect(getFlowErrorMessage(error)).toBe(
      'The request was not valid. Check the values and try again.',
    );
  });

  it('uses the board messages otherwise', () => {
    expect(getFlowErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK', config))).toBe(
      'Unable to reach the server. Please try again.',
    );
    expect(
      getFlowErrorMessage(failure(503, { error: { code: 'BOARD_BUSY', message: 'busy' } })),
    ).toBe('The board is busy right now. Please try again in a moment.');
  });
});
