import type { ErrorResponse } from '@streamline/shared';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../errors/app-error.js';

/** Errors raised by body-parser carry a 4xx status and a message that is safe to expose. */
function isHttpClientError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let status: number;
  let body: ErrorResponse;

  if (err instanceof AppError) {
    status = err.statusCode;
    body = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: err.issues },
    };
  } else if (isHttpClientError(err)) {
    status = err.status;
    body = { error: { code: 'BAD_REQUEST', message: err.message } };
  } else {
    req.log.error({ err }, 'Unhandled error');
    status = 500;
    body = { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } };
  }

  res.status(status).json(body);
};
