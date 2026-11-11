import { beforeEach, describe, expect, it } from 'vitest';

import { sessionWith, testUser } from '@/test/fixtures';

import { resetAuthStore, useAuthStore } from './auth';

beforeEach(() => {
  resetAuthStore();
  localStorage.clear();
  sessionStorage.clear();
});

describe('auth store', () => {
  it('starts idle without a session', () => {
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      accessToken: null,
      status: 'idle',
    });
  });

  it('stores and clears the session', () => {
    useAuthStore.getState().setLoading();
    expect(useAuthStore.getState().status).toBe('loading');

    useAuthStore.getState().setSession(sessionWith('token-1'));
    expect(useAuthStore.getState()).toMatchObject({
      user: testUser,
      accessToken: 'token-1',
      status: 'authenticated',
    });

    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      accessToken: null,
      status: 'unauthenticated',
    });
  });

  it('keeps the access token out of web storage and cookies', () => {
    useAuthStore.getState().setSession(sessionWith('secret-token'));

    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(document.cookie).not.toContain('secret-token');
  });
});
