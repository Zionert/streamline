import { errorResponseSchema } from '@streamline/shared';
import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { ForbiddenError, NotFoundError } from '../errors/app-error.js';
import type { BoardAccessService, BoardMembership } from '../services/board-access.service.js';
import { errorHandler } from './error-handler.js';
import { createRequireBoardPermission, getBoardMembership } from './require-board-permission.js';

const fakeAuth: RequestHandler = (req, _res, next) => {
  req.userId = 'user-1';
  next();
};

function buildApp(impl: BoardAccessService['require']) {
  const access = { require: vi.fn(impl) };
  const can = createRequireBoardPermission(access);
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(fakeAuth);
  app.get('/boards/:boardId', can('board:view'), (_req, res) => {
    res.json(getBoardMembership(res));
  });
  app.get('/projects/:id/settings', can('board:rename', { param: 'id' }), (_req, res) => {
    res.json(getBoardMembership(res));
  });
  app.get('/unguarded', (_req, res) => {
    res.json(getBoardMembership(res));
  });
  app.use(errorHandler);
  return { app, access };
}

const membership = (boardId: string): BoardMembership => ({
  boardId,
  userId: 'user-1',
  role: 'ADMIN',
});

describe('requireBoardPermission', () => {
  it('exposes the verified membership to the handler', async () => {
    const { app, access } = buildApp((boardId) => Promise.resolve(membership(boardId)));

    const response = await request(app).get('/boards/b1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(membership('b1'));
    expect(access.require).toHaveBeenCalledWith('b1', 'user-1', 'board:view');
  });

  it('reads the board id from a custom route parameter', async () => {
    const { app, access } = buildApp((boardId) => Promise.resolve(membership(boardId)));

    const response = await request(app).get('/projects/b2/settings');

    expect(response.status).toBe(200);
    expect(access.require).toHaveBeenCalledWith('b2', 'user-1', 'board:rename');
  });

  it.each([
    [new NotFoundError('Board not found'), 404, 'NOT_FOUND'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
  ])('propagates %s', async (error, status, code) => {
    const { app } = buildApp(() => Promise.reject(error));

    const response = await request(app).get('/boards/b1');

    expect(response.status).toBe(status);
    expect(errorResponseSchema.parse(response.body).error.code).toBe(code);
  });

  it('fails loudly when a handler reads the membership on an unguarded route', async () => {
    const { app } = buildApp(() => Promise.resolve(membership('b1')));

    expect((await request(app).get('/unguarded')).status).toBe(500);
  });
});
