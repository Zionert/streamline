import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { TooManyRequestsError } from '../errors/app-error.js';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  /** Count only failed requests (status >= 400), e.g. wrong passwords. */
  skipSuccessfulRequests?: boolean;
}

/** Per-IP rate limiter (in-memory store) responding with the standard error format. */
export function createRateLimiter({
  windowMs,
  limit,
  skipSuccessfulRequests = false,
}: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError());
    },
  });
}
