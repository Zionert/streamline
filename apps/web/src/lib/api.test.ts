import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAuthStore, useAuthStore } from '@/stores/auth';
import { sessionWith, testUser } from '@/test/fixtures';
import {
  createMockAdapter,
  deferred,
  errorBody,
  type MockAdapter,
  type MockReply,
} from '@/test/mockAdapter';

import { REFRESH_TOKEN_ROTATED, StaleRefreshError, createApiClient, isAuthEndpoint } from './api';

const ROTATED_DELAY_MS = 123;

let mock: MockAdapter;
let sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

function setup() {
  return createApiClient({
    adapter: mock.adapter,
    sleep,
    rotatedRetryDelayMs: ROTATED_DELAY_MS,
  });
}

function loggedInWith(token: string) {
  useAuthStore.getState().setSession(sessionWith(token));
}

/** `GET /boards` succeeds only with the given token, otherwise 401. */
function boardsRequire(token: string) {
  mock.on('GET', '/boards', (config) =>
    config.headers.get('Authorization') === `Bearer ${token}`
      ? { status: 200, data: { boards: [] } }
      : { status: 401, data: errorBody('UNAUTHORIZED') },
  );
}

const unauthorized: MockReply = { status: 401, data: errorBody('UNAUTHORIZED') };
const rotated: MockReply = { status: 401, data: errorBody(REFRESH_TOKEN_ROTATED) };

beforeEach(() => {
  resetAuthStore();
  mock = createMockAdapter();
  sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
});

describe('api client', () => {
  it('uses the /api base URL, sends credentials and attaches the access token', async () => {
    const { api } = setup();
    loggedInWith('token-1');
    mock.on('GET', '/boards', { status: 200, data: {} });

    await api.get('/boards');

    expect(api.defaults.baseURL).toBe('/api');
    expect(mock.requests[0]).toMatchObject({
      authorization: 'Bearer token-1',
      withCredentials: true,
    });
  });

  it('sends no Authorization header without a session', async () => {
    const { api } = setup();
    mock.on('GET', '/health', { status: 200, data: {} });

    await api.get('/health');

    expect(mock.requests[0]?.authorization).toBeUndefined();
  });

  it('refreshes the session on 401 and retries the request with the new token', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    mock.on('POST', '/auth/refresh', { status: 200, data: sessionWith('new') });

    const response = await api.get('/boards');

    expect(response.status).toBe(200);
    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(mock.requestsTo('GET', '/boards').map((r) => r.authorization)).toEqual([
      'Bearer old',
      'Bearer new',
    ]);
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'new',
      user: testUser,
      status: 'authenticated',
    });
  });

  it('shares a single refresh between concurrent 401 responses', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    const refreshGate = deferred<MockReply>();
    mock.on('POST', '/auth/refresh', () => refreshGate.promise);

    const pending = Promise.all([api.get('/boards'), api.get('/boards'), api.get('/boards')]);
    await vi.waitFor(() => expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1));
    refreshGate.resolve({ status: 200, data: sessionWith('new') });
    const responses = await pending;

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(mock.requestsTo('GET', '/boards')).toHaveLength(6);
  });

  it('replays a request with the current token when the session was refreshed meanwhile', async () => {
    const { api } = setup();
    loggedInWith('old');
    mock.on('GET', '/boards', (config) => {
      // The session gets refreshed elsewhere while this request is in flight.
      loggedInWith('new');
      return config.headers.get('Authorization') === 'Bearer new'
        ? { status: 200, data: {} }
        : unauthorized;
    });

    await api.get('/boards');

    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(0);
    expect(mock.requestsTo('GET', '/boards')).toHaveLength(2);
  });

  it('waits and retries the refresh once after REFRESH_TOKEN_ROTATED', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    mock.on('POST', '/auth/refresh', rotated, { status: 200, data: sessionWith('new') });

    const response = await api.get('/boards');

    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(ROTATED_DELAY_MS);
    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(2);
    expect(useAuthStore.getState().accessToken).toBe('new');
  });

  it('logs the user out when the delayed refresh retry fails as well', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    mock.on('POST', '/auth/refresh', rotated, rotated);

    await expect(api.get('/boards')).rejects.toMatchObject({ response: { status: 401 } });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(2);
    expect(mock.requestsTo('GET', '/boards')).toHaveLength(1);
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
    });
  });

  it('does not loop when /auth/refresh itself is rejected', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    mock.on('POST', '/auth/refresh', unauthorized);

    await expect(api.get('/boards')).rejects.toMatchObject({ response: { status: 401 } });

    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('does not refresh again when the replayed request is rejected with 401', async () => {
    const { api } = setup();
    loggedInWith('old');
    mock.on('GET', '/boards', unauthorized);
    mock.on('POST', '/auth/refresh', { status: 200, data: sessionWith('new') });

    await expect(api.get('/boards')).rejects.toMatchObject({ response: { status: 401 } });

    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(mock.requestsTo('GET', '/boards')).toHaveLength(2);
  });

  it.each(['/auth/login', '/auth/register', '/auth/logout', '/auth/refresh'])(
    'does not try to refresh after a 401 from %s',
    async (url) => {
      const { api } = setup();
      loggedInWith('old');
      mock.on('POST', url, unauthorized);
      mock.on('POST', '/auth/refresh', unauthorized);

      await expect(api.post(url)).rejects.toMatchObject({ response: { status: 401 } });

      expect(mock.requests).toHaveLength(1);
    },
  );

  it('keeps the session when the refresh fails for a reason other than 401', async () => {
    const { api } = setup();
    loggedInWith('old');
    boardsRequire('new');
    mock.on('POST', '/auth/refresh', 'network-error');

    await expect(api.get('/boards')).rejects.toMatchObject({ response: { status: 401 } });

    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'old', status: 'authenticated' });
  });

  it('logs the user out when the refresh response does not match the schema', async () => {
    const { refreshSession } = setup();
    loggedInWith('old');
    mock.on('POST', '/auth/refresh', { status: 200, data: { accessToken: 'new' } });

    await expect(refreshSession()).rejects.toThrow();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('discards a refresh result that arrives after the session was cleared', async () => {
    const { api, refreshSession } = setup();
    loggedInWith('old');
    boardsRequire('new');
    const refreshGate = deferred<MockReply>();
    mock.on('POST', '/auth/refresh', () => refreshGate.promise);

    const request = api.get('/boards');
    const refresh = refreshSession();
    await vi.waitFor(() => expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1));
    useAuthStore.getState().clearSession();
    refreshGate.resolve({ status: 200, data: sessionWith('new') });

    await expect(refresh).rejects.toBeInstanceOf(StaleRefreshError);
    await expect(request).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      user: null,
      status: 'unauthenticated',
    });
    expect(mock.requestsTo('GET', '/boards')).toHaveLength(1);
  });

  it('does not clear a newer session when a stale refresh fails', async () => {
    const { refreshSession } = setup();
    loggedInWith('old');
    const refreshGate = deferred<MockReply>();
    mock.on('POST', '/auth/refresh', () => refreshGate.promise);

    const refresh = refreshSession();
    await vi.waitFor(() => expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1));
    useAuthStore.getState().clearSession();
    loggedInWith('fresh-login');
    refreshGate.resolve(unauthorized);

    await expect(refresh).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'fresh-login',
      status: 'authenticated',
    });
  });

  it('waitForPendingRefresh settles after the refresh, even when it fails', async () => {
    const { refreshSession, waitForPendingRefresh } = setup();
    await expect(waitForPendingRefresh()).resolves.toBeUndefined();

    const refreshGate = deferred<MockReply>();
    mock.on('POST', '/auth/refresh', () => refreshGate.promise);
    const refresh = refreshSession();
    let settled = false;
    const waiting = waitForPendingRefresh().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(1));
    expect(settled).toBe(false);

    refreshGate.resolve(unauthorized);
    await expect(refresh).rejects.toBeDefined();
    await waiting;
    expect(settled).toBe(true);
  });

  it('does not touch the session on errors other than 401', async () => {
    const { api } = setup();
    loggedInWith('old');
    mock.on('GET', '/boards', { status: 500, data: errorBody('INTERNAL_ERROR') });

    await expect(api.get('/boards')).rejects.toMatchObject({ response: { status: 500 } });

    expect(mock.requestsTo('POST', '/auth/refresh')).toHaveLength(0);
  });
});

describe('isAuthEndpoint', () => {
  it.each([
    ['/auth/refresh', true],
    ['auth/login', true],
    ['/api/auth/register', true],
    ['/auth/logout?x=1', true],
    ['/auth/me', false],
    ['/boards', false],
    ['/auth/refresh-tokens', false],
    [undefined, false],
  ])('%s -> %s', (url, expected) => {
    expect(isAuthEndpoint(url)).toBe(expected);
  });
});
