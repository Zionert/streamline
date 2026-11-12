import {
  authResponseSchema,
  errorResponseSchema,
  meResponseSchema,
  type AuthResponse,
} from '@streamline/shared';
import type { Express } from 'express';
import { SignJWT } from 'jose';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { REFRESH_COOKIE_NAME } from '../controllers/auth.controller.js';
import type { DbClient } from '../repositories/db.js';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  hashRefreshToken,
} from '../services/token.service.js';
import { buildTestApp, createTestDb, resetDatabase, TEST_JWT_SECRET } from '../test/helpers.js';

const credentials = { email: 'jane@example.com', password: 'correct-horse-battery', name: 'Jane' };

let db: DbClient;
let app: Express;

beforeAll(() => {
  db = createTestDb();
  app = buildTestApp(db);
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

function setCookieHeaders(response: Response): string[] {
  const header: unknown = response.headers['set-cookie'];
  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }
  return typeof header === 'string' ? [header] : [];
}

function refreshCookieHeader(response: Response): string {
  const cookie = setCookieHeaders(response).find((value) =>
    value.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
  if (!cookie) {
    throw new Error('Response does not set the refresh cookie');
  }
  return cookie;
}

/** Raw refresh token value from the Set-Cookie header. */
function refreshTokenFrom(response: Response): string {
  const value = refreshCookieHeader(response).split(';')[0]?.split('=')[1];
  if (!value) {
    throw new Error('Refresh cookie has no value');
  }
  return decodeURIComponent(value);
}

function cookie(token: string): string {
  return `${REFRESH_COOKIE_NAME}=${token}`;
}

/** Moves the revocation of a token back in time, past the reuse grace window (30 s by default). */
async function revokedLongAgo(token: string): Promise<void> {
  await db.refreshToken.update({
    where: { tokenHash: hashRefreshToken(token) },
    data: { revokedAt: new Date(Date.now() - 60_000) },
  });
}

function errorCode(response: Response): string {
  return errorResponseSchema.parse(response.body).error.code;
}

async function register(body: object = credentials): Promise<Response> {
  return request(app).post('/auth/register').send(body);
}

async function registerOk(): Promise<{ response: Response; body: AuthResponse }> {
  const response = await register();
  expect(response.status).toBe(201);
  return { response, body: authResponseSchema.parse(response.body) };
}

describe('POST /auth/register', () => {
  it('creates the user and returns an access token, the public user and a refresh cookie', async () => {
    const response = await register({ ...credentials, email: '  Jane@Example.COM ' });

    expect(response.status).toBe(201);
    const body = authResponseSchema.parse(response.body);
    expect(body.user).toMatchObject({ email: 'jane@example.com', name: 'Jane' });
    expect(response.body).not.toHaveProperty('user.passwordHash');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(refreshTokenFrom(response)).toMatch(/^[\w-]{43}$/);

    const stored = await db.user.findUniqueOrThrow({ where: { email: 'jane@example.com' } });
    expect(stored.passwordHash).not.toBe(credentials.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('stores only the hash of the refresh token', async () => {
    const { response } = await registerOk();
    const token = refreshTokenFrom(response);

    expect(await db.refreshToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(await db.refreshToken.count({ where: { tokenHash: hashRefreshToken(token) } })).toBe(1);
  });

  it('returns 409 for an already registered email (case-insensitive)', async () => {
    await registerOk();
    const response = await register({ ...credentials, email: 'JANE@example.com' });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('CONFLICT');
  });

  it.each([
    ['an invalid email', { ...credentials, email: 'nope' }],
    ['a short password', { ...credentials, password: 'short' }],
    ['a missing name', { email: credentials.email, password: credentials.password }],
    ['no body', undefined],
  ])('returns 400 for %s', async (_case, body) => {
    const response = await request(app).post('/auth/register').send(body);

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body)).not.toContain(credentials.password);
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerOk();
  });

  it('returns 200 with an access token and a refresh cookie', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'JANE@example.com', password: credentials.password });

    expect(response.status).toBe(200);
    expect(authResponseSchema.parse(response.body).user.email).toBe('jane@example.com');
    expect(refreshTokenFrom(response)).toBeTruthy();
  });

  it('returns the same generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: credentials.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(errorResponseSchema.parse(wrongPassword.body).error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
    expect(setCookieHeaders(wrongPassword)).toHaveLength(0);
  });

  it('returns 400 for invalid input', async () => {
    const response = await request(app).post('/auth/login').send({ email: credentials.email });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('VALIDATION_ERROR');
  });
});

describe('GET /auth/me', () => {
  it('returns the current user for a valid access token', async () => {
    const { body } = await registerOk();

    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(response.body).user).toEqual(body.user);
  });

  it('returns 401 without an Authorization header', async () => {
    const response = await request(app).get('/auth/me');

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed or tampered token', async () => {
    const { body } = await registerOk();

    const malformed = await request(app).get('/auth/me').set('Authorization', 'Bearer not-a-jwt');
    const tampered = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken.slice(0, -2)}xx`);
    const wrongScheme = await request(app)
      .get('/auth/me')
      .set('Authorization', `Basic ${body.accessToken}`);

    expect(malformed.status).toBe(401);
    expect(tampered.status).toBe(401);
    expect(wrongScheme.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const { body } = await registerOk();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(body.user.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 60)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));

    const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${expired}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a token signed with another secret', async () => {
    const { body } = await registerOk();
    const forged = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(body.user.id)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('another-secret-that-is-long-enough-0123456789'));

    const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${forged}`);

    expect(response.status).toBe(401);
  });

  it('returns 401 for an unsigned (alg "none") token', async () => {
    const { body } = await registerOk();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: body.user.id,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;

    const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${unsigned}`);

    expect(response.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and returns a new session', async () => {
    const { response: registered, body: registeredBody } = await registerOk();
    const oldToken = refreshTokenFrom(registered);

    const response = await request(app).post('/auth/refresh').set('Cookie', cookie(oldToken));

    expect(response.status).toBe(200);
    const body = authResponseSchema.parse(response.body);
    expect(body.user).toEqual(registeredBody.user);
    const newToken = refreshTokenFrom(response);
    expect(newToken).not.toBe(oldToken);

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);

    const oldRow = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(oldToken) },
    });
    const newRow = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(newToken) },
    });
    expect(oldRow.revokedAt).not.toBeNull();
    expect(oldRow.replacedById).toBe(newRow.id);
    expect(newRow.revokedAt).toBeNull();
  });

  it('rejects a just-rotated token with REFRESH_TOKEN_ROTATED, keeping the cookie and sessions', async () => {
    const { response: registered } = await registerOk();
    const oldToken = refreshTokenFrom(registered);
    const rotated = await request(app).post('/auth/refresh').set('Cookie', cookie(oldToken));
    expect(rotated.status).toBe(200);

    const reused = await request(app).post('/auth/refresh').set('Cookie', cookie(oldToken));

    expect(reused.status).toBe(401);
    expect(errorCode(reused)).toBe('REFRESH_TOKEN_ROTATED');
    expect(setCookieHeaders(reused)).toHaveLength(0);
    await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(rotated)))
      .expect(200);
  });

  it('handles concurrent refreshes with the same cookie (e.g. several tabs) without a logout', async () => {
    const { response: registered } = await registerOk();
    const token = refreshTokenFrom(registered);
    const otherDevice = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });

    const responses = await Promise.all([
      request(app).post('/auth/refresh').set('Cookie', cookie(token)),
      request(app).post('/auth/refresh').set('Cookie', cookie(token)),
    ]);

    const winners = responses.filter((response) => response.status === 200);
    const losers = responses.filter((response) => response.status === 401);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const [winner] = winners;
    const [loser] = losers;
    if (!winner || !loser) throw new Error('Expected one winner and one loser');
    expect(errorCode(loser)).toBe('REFRESH_TOKEN_ROTATED');
    expect(setCookieHeaders(loser)).toHaveLength(0);

    // Only the presented token was revoked; the other device and the new token keep working.
    expect(await db.refreshToken.count({ where: { revokedAt: { not: null } } })).toBe(1);
    await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(winner)))
      .expect(200);
    await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(otherDevice)))
      .expect(200);
  });

  it('treats reuse after the grace window as theft and revokes all sessions of the user', async () => {
    const { response: registered } = await registerOk();
    const stolen = refreshTokenFrom(registered);
    const rotated = await request(app).post('/auth/refresh').set('Cookie', cookie(stolen));
    const currentToken = refreshTokenFrom(rotated);
    const otherDevice = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });
    const otherDeviceToken = refreshTokenFrom(otherDevice);
    await revokedLongAgo(stolen);

    const reused = await request(app).post('/auth/refresh').set('Cookie', cookie(stolen));

    expect(reused.status).toBe(401);
    expect(errorCode(reused)).toBe('UNAUTHORIZED');
    expect(refreshCookieHeader(reused)).toMatch(/Expires=Thu, 01 Jan 1970/);

    expect(await db.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    await request(app).post('/auth/refresh').set('Cookie', cookie(currentToken)).expect(401);
    await request(app).post('/auth/refresh').set('Cookie', cookie(otherDeviceToken)).expect(401);
  });

  it('treats any reuse as theft when the grace window is disabled', async () => {
    const strictApp = buildTestApp(db, { REFRESH_REUSE_GRACE_SECONDS: '0' });
    const { response: registered } = await registerOk();
    const token = refreshTokenFrom(registered);
    await request(strictApp).post('/auth/refresh').set('Cookie', cookie(token)).expect(200);

    const reused = await request(strictApp).post('/auth/refresh').set('Cookie', cookie(token));

    expect(errorCode(reused)).toBe('UNAUTHORIZED');
    expect(await db.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('treats reuse of a logged-out token as theft even within the grace window', async () => {
    const { response: registered } = await registerOk();
    const loggedOut = refreshTokenFrom(registered);
    await request(app).post('/auth/logout').set('Cookie', cookie(loggedOut)).expect(204);
    const otherDevice = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });

    const reused = await request(app).post('/auth/refresh').set('Cookie', cookie(loggedOut));

    expect(errorCode(reused)).toBe('UNAUTHORIZED');
    await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(otherDevice)))
      .expect(401);
  });

  it('does not revoke sessions of other users on reuse', async () => {
    const { response: registered } = await registerOk();
    const stolen = refreshTokenFrom(registered);
    await request(app).post('/auth/refresh').set('Cookie', cookie(stolen)).expect(200);
    const other = await register({ ...credentials, email: 'john@example.com', name: 'John' });
    await revokedLongAgo(stolen);

    await request(app).post('/auth/refresh').set('Cookie', cookie(stolen)).expect(401);

    await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(other)))
      .expect(200);
  });

  it('returns 401 without a refresh cookie', async () => {
    const response = await request(app).post('/auth/refresh');

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe('UNAUTHORIZED');
  });

  it('returns 401 and clears the cookie for an unknown token', async () => {
    const response = await request(app).post('/auth/refresh').set('Cookie', cookie('unknown'));

    expect(response.status).toBe(401);
    expect(refreshCookieHeader(response)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('returns 401 for an expired token', async () => {
    const { response: registered } = await registerOk();
    const token = refreshTokenFrom(registered);
    await db.refreshToken.update({
      where: { tokenHash: hashRefreshToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await request(app).post('/auth/refresh').set('Cookie', cookie(token));

    expect(response.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token, clears the cookie and returns 204', async () => {
    const { response: registered } = await registerOk();
    const token = refreshTokenFrom(registered);

    const response = await request(app).post('/auth/logout').set('Cookie', cookie(token));

    expect(response.status).toBe(204);
    expect(refreshCookieHeader(response)).toMatch(/Expires=Thu, 01 Jan 1970/);
    const row = await db.refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(token) },
    });
    expect(row.revokedAt).not.toBeNull();
    await request(app).post('/auth/refresh').set('Cookie', cookie(token)).expect(401);
  });

  it('is idempotent and succeeds without a cookie', async () => {
    const { response: registered } = await registerOk();
    const token = refreshTokenFrom(registered);

    await request(app).post('/auth/logout').set('Cookie', cookie(token)).expect(204);
    await request(app).post('/auth/logout').set('Cookie', cookie(token)).expect(204);
    await request(app).post('/auth/logout').expect(204);
  });
});

describe('refresh cookie attributes', () => {
  it('is HttpOnly, SameSite=Strict, limited to the auth path and not Secure outside production', async () => {
    const { response } = await registerOk();
    const header = refreshCookieHeader(response);

    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; SameSite=Strict/);
    expect(header).toMatch(/; Path=\/api\/auth(;|$)/);
    expect(header).toMatch(/; Max-Age=604800/);
    expect(header).not.toMatch(/; Secure/);
  });

  it('is Secure in production and uses the configured path', async () => {
    const productionApp = buildTestApp(db, {
      NODE_ENV: 'production',
      BCRYPT_COST: '12',
      REFRESH_COOKIE_PATH: '/auth',
    });
    // Register through the default test app and use refresh, so no slow cost-12 hashing runs.
    const { response: registered } = await registerOk();

    const response = await request(productionApp)
      .post('/auth/refresh')
      .set('Cookie', cookie(refreshTokenFrom(registered)));

    expect(response.status).toBe(200);
    const header = refreshCookieHeader(response);
    expect(header).toMatch(/; Secure/);
    expect(header).toMatch(/; Path=\/auth(;|$)/);
  });

  it('never puts the access token in a cookie', async () => {
    const { response, body } = await registerOk();

    expect(setCookieHeaders(response).join('\n')).not.toContain(body.accessToken);
  });
});

describe('rate limiting', () => {
  it('returns 429 after too many failed login attempts', async () => {
    const limitedApp = buildTestApp(db, { AUTH_CREDENTIALS_RATE_LIMIT_MAX: '3' });
    const attempt = () =>
      request(limitedApp)
        .post('/auth/login')
        .send({ email: 'ghost@example.com', password: 'wrong-password' });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not count successful logins towards the credentials limit', async () => {
    const limitedApp = buildTestApp(db, { AUTH_CREDENTIALS_RATE_LIMIT_MAX: '2' });
    await registerOk();
    const login = () =>
      request(limitedApp)
        .post('/auth/login')
        .send({ email: credentials.email, password: credentials.password });

    for (let i = 0; i < 4; i += 1) {
      expect((await login()).status).toBe(200);
    }
  });

  it('limits all auth endpoints with the general limit', async () => {
    const limitedApp = buildTestApp(db, { AUTH_RATE_LIMIT_MAX: '2' });

    await request(limitedApp).post('/auth/logout').expect(204);
    await request(limitedApp).post('/auth/logout').expect(204);
    const blocked = await request(limitedApp).post('/auth/logout');

    expect(blocked.status).toBe(429);
    // Other routes are not affected.
    await request(limitedApp).get('/health').expect(200);
  });
});
