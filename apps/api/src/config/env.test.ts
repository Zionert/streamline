import { describe, expect, it } from 'vitest';

import { loadAiConfig, loadConfig } from './env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
const JWT_ACCESS_SECRET = 'a'.repeat(32);
const required = { DATABASE_URL, JWT_ACCESS_SECRET };

describe('loadConfig', () => {
  it('applies defaults when optional variables are missing', () => {
    const config = loadConfig(required);

    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      DATABASE_URL,
      CORS_ORIGIN: ['http://localhost:5173'],
      LOG_LEVEL: 'info',
      JWT_ACCESS_SECRET,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604800,
      REFRESH_REUSE_GRACE_SECONDS: 30,
      REFRESH_COOKIE_PATH: '/api/auth',
      BCRYPT_COST: 12,
      AUTH_RATE_LIMIT_WINDOW_MS: 900000,
      AUTH_RATE_LIMIT_MAX: 100,
      AUTH_CREDENTIALS_RATE_LIMIT_MAX: 10,
      AI_ENABLED: false,
      LLM_BASE_URL: undefined,
      LLM_MODEL: undefined,
      LLM_API_KEY: undefined,
      LLM_TIMEOUT_MS: 60000,
      LLM_IDLE_TIMEOUT_MS: 30000,
      LLM_CONTEXT_TOKENS: 16000,
      AI_DAILY_REQUEST_LIMIT: 200,
      AI_DAILY_TOKEN_LIMIT: 500000,
      LLM_REASONING_EFFORT: 'none',
    });
  });

  it('coerces PORT and splits a comma-separated CORS_ORIGIN', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      CORS_ORIGIN: 'http://localhost:5173, https://streamline.example',
    });

    expect(config.PORT).toBe(8080);
    expect(config.CORS_ORIGIN).toEqual(['http://localhost:5173', 'https://streamline.example']);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({ JWT_ACCESS_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a PostgreSQL URL', () => {
    expect(() => loadConfig({ JWT_ACCESS_SECRET, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ ...required, PORT: '70000' })).toThrow(/PORT/);
  });

  it('throws when JWT_ACCESS_SECRET is missing or too short', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ DATABASE_URL, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('coerces token TTLs and rate limits from strings', () => {
    const config = loadConfig({
      ...required,
      ACCESS_TOKEN_TTL_SECONDS: '60',
      REFRESH_TOKEN_TTL_SECONDS: '120',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_CREDENTIALS_RATE_LIMIT_MAX: '2',
    });

    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(60);
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(120);
    expect(config.AUTH_RATE_LIMIT_MAX).toBe(5);
    expect(config.AUTH_CREDENTIALS_RATE_LIMIT_MAX).toBe(2);
  });

  it('validates REFRESH_REUSE_GRACE_SECONDS', () => {
    expect(
      loadConfig({ ...required, REFRESH_REUSE_GRACE_SECONDS: '0' }).REFRESH_REUSE_GRACE_SECONDS,
    ).toBe(0);
    expect(() => loadConfig({ ...required, REFRESH_REUSE_GRACE_SECONDS: '-1' })).toThrow(
      /REFRESH_REUSE_GRACE_SECONDS/,
    );
  });

  it('allows a low BCRYPT_COST outside production', () => {
    expect(loadConfig({ ...required, NODE_ENV: 'test', BCRYPT_COST: '4' }).BCRYPT_COST).toBe(4);
  });

  it('rejects a BCRYPT_COST below 12 in production', () => {
    expect(() => loadConfig({ ...required, NODE_ENV: 'production', BCRYPT_COST: '10' })).toThrow(
      /BCRYPT_COST/,
    );
  });

  it('rejects a REFRESH_COOKIE_PATH that is not absolute', () => {
    expect(() => loadConfig({ ...required, REFRESH_COOKIE_PATH: 'auth' })).toThrow(
      /REFRESH_COOKIE_PATH/,
    );
  });

  describe('AI assistant configuration', () => {
    const ollama = {
      AI_ENABLED: 'true',
      LLM_BASE_URL: 'http://localhost:11434/v1',
      LLM_MODEL: 'qwen3.5:9b',
    };

    it('requires nothing LLM-related while the assistant is disabled', () => {
      const config = loadConfig({ ...required, AI_ENABLED: 'false', LLM_BASE_URL: 'not a url' });

      expect(config.AI_ENABLED).toBe(false);
      expect(config.LLM_MODEL).toBeUndefined();
    });

    it('accepts an enabled assistant without an API key (local Ollama)', () => {
      const config = loadConfig({ ...required, ...ollama, LLM_API_KEY: '' });

      expect(config).toMatchObject({
        AI_ENABLED: true,
        LLM_BASE_URL: 'http://localhost:11434/v1',
        LLM_MODEL: 'qwen3.5:9b',
      });
      expect(config.LLM_API_KEY).toBeUndefined();
    });

    it('keeps the API key and coerces the numeric limits', () => {
      const config = loadConfig({
        ...required,
        ...ollama,
        LLM_API_KEY: 'sk-test',
        LLM_TIMEOUT_MS: '1000',
        LLM_IDLE_TIMEOUT_MS: '500',
        LLM_CONTEXT_TOKENS: '8000',
        AI_DAILY_REQUEST_LIMIT: '5',
        AI_DAILY_TOKEN_LIMIT: '1000',
      });

      expect(config).toMatchObject({
        LLM_API_KEY: 'sk-test',
        LLM_TIMEOUT_MS: 1000,
        LLM_IDLE_TIMEOUT_MS: 500,
        LLM_CONTEXT_TOKENS: 8000,
        AI_DAILY_REQUEST_LIMIT: 5,
        AI_DAILY_TOKEN_LIMIT: 1000,
      });
    });

    it('requires LLM_BASE_URL and LLM_MODEL when the assistant is enabled', () => {
      expect(() => loadConfig({ ...required, AI_ENABLED: 'true' })).toThrow(
        /LLM_BASE_URL is required when AI_ENABLED=true[\s\S]*LLM_MODEL is required/,
      );
      expect(() => loadConfig({ ...required, ...ollama, LLM_MODEL: ' ' })).toThrow(/LLM_MODEL/);
    });

    it('rejects an LLM_BASE_URL that is not an http(s) URL when enabled', () => {
      expect(() => loadConfig({ ...required, ...ollama, LLM_BASE_URL: 'localhost:11434' })).toThrow(
        /LLM_BASE_URL must be an http\(s\) URL/,
      );
    });

    it('rejects an AI_ENABLED value that is not a boolean', () => {
      expect(() => loadConfig({ ...required, AI_ENABLED: 'maybe' })).toThrow(/AI_ENABLED/);
    });

    it('loads only the AI part with loadAiConfig (no database variables needed)', () => {
      expect(loadAiConfig(ollama)).toMatchObject({ AI_ENABLED: true, LLM_MODEL: 'qwen3.5:9b' });
      expect(loadAiConfig({}).AI_ENABLED).toBe(false);
    });

    it('validates LLM_REASONING_EFFORT; "default" or an empty value means "do not send"', () => {
      const effort = (value: string) =>
        loadConfig({ ...required, LLM_REASONING_EFFORT: value }).LLM_REASONING_EFFORT;

      expect(loadConfig(required).LLM_REASONING_EFFORT).toBe('none');
      for (const value of ['none', 'minimal', 'low', 'medium', 'high', 'default'] as const) {
        expect(effort(value)).toBe(value);
      }
      expect(effort(' Medium ')).toBe('medium');
      expect(effort('')).toBe('default');
      expect(() => effort('turbo')).toThrow(/LLM_REASONING_EFFORT/);
    });

    it('accepts boolean-like values for AI_ENABLED', () => {
      expect(loadAiConfig({ ...ollama, AI_ENABLED: '1' }).AI_ENABLED).toBe(true);
      expect(loadAiConfig({ ...ollama, AI_ENABLED: 'yes' }).AI_ENABLED).toBe(true);
      expect(loadAiConfig({ ...ollama, AI_ENABLED: '0' }).AI_ENABLED).toBe(false);
    });

    it('reports a missing LLM_BASE_URL from loadAiConfig', () => {
      expect(() => loadAiConfig({ AI_ENABLED: '1', LLM_MODEL: 'qwen3.5:9b' })).toThrow(
        /Invalid AI configuration[\s\S]*LLM_BASE_URL is required/,
      );
    });
  });
});
