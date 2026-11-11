import { errorResponseSchema, healthResponseSchema } from '@streamline/shared';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const FRONTEND_ORIGIN = 'http://localhost:5173';

function buildApp() {
  return createApp({
    config: { CORS_ORIGIN: [FRONTEND_ORIGIN] },
    logger: pino({ level: 'silent' }),
  });
}

describe('GET /health', () => {
  it('returns 200 with a body matching the shared health schema', async () => {
    const response = await request(buildApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(healthResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('sets security headers', async () => {
    const response = await request(buildApp()).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS requests from the configured origin only', async () => {
    const allowed = await request(buildApp()).get('/health').set('Origin', FRONTEND_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);

    const denied = await request(buildApp()).get('/health').set('Origin', 'http://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('returns 404 in the standard error format for unknown routes', async () => {
    const response = await request(buildApp()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await request(buildApp())
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('BAD_REQUEST');
  });
});
