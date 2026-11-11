import { errorResponseSchema } from '@streamline/shared';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError, NotFoundError, ValidationError } from '../errors/app-error.js';
import { errorHandler } from './error-handler.js';

function appThrowing(error: unknown) {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.get('/', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

async function getError(error: unknown) {
  const response = await request(appThrowing(error)).get('/');
  return { status: response.status, body: errorResponseSchema.parse(response.body) };
}

describe('errorHandler', () => {
  it('maps AppError subclasses to their status and code', async () => {
    const { status, body } = await getError(new NotFoundError('Board not found'));

    expect(status).toBe(404);
    expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Board not found' });
  });

  it('includes details when provided', async () => {
    const { status, body } = await getError(new ValidationError('Bad input', { field: 'title' }));

    expect(status).toBe(400);
    expect(body.error.details).toEqual({ field: 'title' });
  });

  it('supports custom AppError instances', async () => {
    const { status, body } = await getError(new AppError(409, 'CONFLICT', 'Already exists'));

    expect(status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('maps ZodError to 400 VALIDATION_ERROR with issues', async () => {
    const result = z.object({ title: z.string() }).safeParse({});
    const { status, body } = await getError(result.error);

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const { status, body } = await getError(new Error('database password leaked'));

    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  });
});
