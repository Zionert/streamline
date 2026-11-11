import type { RequestHandler } from 'express';

import { UnauthorizedError } from '../errors/app-error.js';
import type { TokenService } from '../services/token.service.js';

declare global {
  // Declaration merging with Express' global Request type requires a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Id of the authenticated user; set by `requireAuth`. */
      userId?: string;
    }
  }
}

const BEARER_PATTERN = /^Bearer ([^\s]+)$/i;

/** Requires a valid `Authorization: Bearer <access token>` header and sets `req.userId`. */
export function createRequireAuth(tokens: Pick<TokenService, 'verifyAccessToken'>): RequestHandler {
  return async (req, _res, next) => {
    const match = BEARER_PATTERN.exec(req.get('authorization') ?? '');
    if (!match?.[1]) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    req.userId = await tokens.verifyAccessToken(match[1]);
    next();
  };
}

/** Returns the authenticated user id; use only in handlers behind `requireAuth`. */
export function getAuthUserId(req: Express.Request): string {
  if (!req.userId) {
    throw new UnauthorizedError();
  }
  return req.userId;
}
