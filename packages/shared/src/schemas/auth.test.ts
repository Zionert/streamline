import { describe, expect, it } from 'vitest';

import {
  authResponseSchema,
  loginSchema,
  PASSWORD_MAX_BYTES,
  publicUserSchema,
  registerSchema,
  utf8ByteLength,
} from './auth.js';

describe('utf8ByteLength', () => {
  it.each(['', 'abc', 'zażółć', '€uro', 'emoji \u{1F600}', 'lone \uD800'])(
    'matches the UTF-8 encoded length of %j',
    (value) => {
      expect(utf8ByteLength(value)).toBe(Buffer.byteLength(value, 'utf8'));
    },
  );
});

const validRegister = { email: 'Jane@Example.com', password: 'correct-horse', name: 'Jane' };

describe('registerSchema', () => {
  it('accepts valid input and normalizes the email', () => {
    const result = registerSchema.parse({ ...validRegister, email: '  Jane.Doe@Example.COM ' });

    expect(result.email).toBe('jane.doe@example.com');
  });

  it('trims the name', () => {
    expect(registerSchema.parse({ ...validRegister, name: '  Jane  ' }).name).toBe('Jane');
  });

  it('rejects an invalid email', () => {
    expect(registerSchema.safeParse({ ...validRegister, email: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(registerSchema.safeParse({ ...validRegister, password: 'short' }).success).toBe(false);
  });

  it('accepts a password of exactly 72 bytes', () => {
    const password = 'a'.repeat(PASSWORD_MAX_BYTES);
    expect(registerSchema.safeParse({ ...validRegister, password }).success).toBe(true);
  });

  it('rejects a password longer than 72 bytes', () => {
    const password = 'a'.repeat(PASSWORD_MAX_BYTES + 1);
    expect(registerSchema.safeParse({ ...validRegister, password }).success).toBe(false);
  });

  it('counts bytes, not characters, for multi-byte passwords', () => {
    // 'ł' is 2 bytes in UTF-8: 37 characters = 74 bytes.
    const password = 'ł'.repeat(37);
    expect(password.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(registerSchema.safeParse({ ...validRegister, password }).success).toBe(false);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(registerSchema.safeParse({ ...validRegister, name: '   ' }).success).toBe(false);
  });

  it('rejects a name longer than 100 characters', () => {
    expect(registerSchema.safeParse({ ...validRegister, name: 'a'.repeat(101) }).success).toBe(
      false,
    );
  });

  it('rejects missing fields', () => {
    expect(registerSchema.safeParse({}).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('normalizes the email', () => {
    expect(loginSchema.parse({ email: 'JANE@example.com', password: 'x' }).email).toBe(
      'jane@example.com',
    );
  });

  it('does not apply registration password rules', () => {
    expect(loginSchema.safeParse({ email: 'jane@example.com', password: 'short' }).success).toBe(
      true,
    );
  });

  it('rejects a password longer than 72 bytes', () => {
    const password = 'a'.repeat(PASSWORD_MAX_BYTES + 1);
    expect(loginSchema.safeParse({ email: 'jane@example.com', password }).success).toBe(false);
  });

  it('rejects an empty password', () => {
    expect(loginSchema.safeParse({ email: 'jane@example.com', password: '' }).success).toBe(false);
  });
});

describe('authResponseSchema', () => {
  const user = {
    id: 'cm0abc',
    email: 'jane@example.com',
    name: 'Jane',
    createdAt: '2026-11-11T10:00:00.000Z',
  };

  it('accepts a valid response', () => {
    expect(authResponseSchema.parse({ accessToken: 'token', user })).toEqual({
      accessToken: 'token',
      user,
    });
  });

  it('strips fields that are not part of the public user', () => {
    expect(publicUserSchema.parse({ ...user, passwordHash: 'secret' })).toEqual(user);
  });

  it('rejects a missing access token', () => {
    expect(authResponseSchema.safeParse({ user }).success).toBe(false);
  });
});
