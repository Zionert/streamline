import { errorResponseSchema } from '@streamline/shared';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../errors/app-error.js';
import { errorHandler } from './error-handler.js';
import { createRequireAuth, getAuthUserId } from './require-auth.js';

const tokens = {
  verifyAccessToken: (token: string) =>
    token === 'valid'
      ? Promise.resolve('user-1')
      : Promise.reject(new UnauthorizedError('Invalid or expired access token')),
};

function buildApp() {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.get('/protected', createRequireAuth(tokens), (req, res) => {
    res.json({ userId: getAuthUserId(req) });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  it('sets req.userId for a valid bearer token', async () => {
    const response = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Bearer valid');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-1' });
  });

  it('accepts a lowercase scheme', async () => {
    const response = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'bearer valid');

    expect(response.status).toBe(200);
  });

  it.each([
    ['missing header', undefined],
    ['empty bearer', 'Bearer '],
    ['other scheme', 'Basic valid'],
    ['extra parts', 'Bearer valid extra'],
    ['invalid token', 'Bearer invalid'],
  ])('responds 401 UNAUTHORIZED for %s', async (_case, header) => {
    const req = request(buildApp()).get('/protected');
    const response = await (header === undefined ? req : req.set('Authorization', header));

    expect(response.status).toBe(401);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('UNAUTHORIZED');
  });
});
