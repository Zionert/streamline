import { z } from 'zod';

import { LLM_REASONING_EFFORTS } from '../ai/llm-provider.js';

/** bcrypt work factor required in production. */
export const PRODUCTION_MIN_BCRYPT_COST = 12;

const positiveInt = z.coerce.number().int().positive();

/** An unset or empty variable (e.g. `LLM_API_KEY=` copied from the example) counts as missing. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

/**
 * Configuration of the AI assistant's model provider (any OpenAI Chat Completions compatible API,
 * e.g. a local Ollama, OpenAI or Gemini). Nothing here is required while `AI_ENABLED` is false.
 */
const aiEnvShape = {
  AI_ENABLED: z.stringbool().default(false),
  /** Base URL of the Chat Completions API, without `/chat/completions`. */
  LLM_BASE_URL: optionalString,
  LLM_MODEL: optionalString,
  /** Sent as a Bearer token when set; a local Ollama needs none. Never logged. */
  LLM_API_KEY: optionalString,
  /**
   * Default `reasoning_effort` sent to the model. `none` disables the "thinking" of reasoning
   * models, so that answers start quickly; `default` or an empty value omits the field (for
   * models that reject it).
   */
  LLM_REASONING_EFFORT: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() || 'default' : value),
    z.enum(LLM_REASONING_EFFORTS).default('none'),
  ),
  /**
   * Upper bound of one model call: the whole streamed response, including the time the caller
   * spends handling the streamed events.
   */
  LLM_TIMEOUT_MS: positiveInt.default(60_000),
  /**
   * Max wait for the response headers and then between two received stream chunks; the time
   * the caller spends handling an event does not count.
   */
  LLM_IDLE_TIMEOUT_MS: positiveInt.default(30_000),
  /** Token budget of the context sent to the model (conversation history is trimmed to it). */
  LLM_CONTEXT_TOKENS: positiveInt.default(16_000),
  /** Assistant requests per user and day. */
  AI_DAILY_REQUEST_LIMIT: positiveInt.default(200),
  /** Prompt and completion tokens per user and day. */
  AI_DAILY_TOKEN_LIMIT: positiveInt.default(500_000),
};

interface AiEnvToCheck {
  AI_ENABLED: boolean;
  LLM_BASE_URL?: string | undefined;
  LLM_MODEL?: string | undefined;
}

/** With the assistant enabled, the provider URL and the model are required. */
function checkAiEnv(env: AiEnvToCheck, ctx: z.RefinementCtx): void {
  if (!env.AI_ENABLED) return;
  if (env.LLM_BASE_URL === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_BASE_URL'],
      message: 'LLM_BASE_URL is required when AI_ENABLED=true (e.g. http://localhost:11434/v1)',
    });
  } else if (!z.url({ protocol: /^https?$/ }).safeParse(env.LLM_BASE_URL).success) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_BASE_URL'],
      message: 'LLM_BASE_URL must be an http(s) URL (e.g. http://localhost:11434/v1)',
    });
  }
  if (env.LLM_MODEL === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['LLM_MODEL'],
      message: 'LLM_MODEL is required when AI_ENABLED=true (e.g. qwen3.5:9b)',
    });
  }
}

const aiEnvSchema = z.object(aiEnvShape).superRefine(checkAiEnv);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.url()).min(1)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
    ACCESS_TOKEN_TTL_SECONDS: positiveInt.default(15 * 60),
    REFRESH_TOKEN_TTL_SECONDS: positiveInt.default(7 * 24 * 60 * 60),
    /** Path of the refresh cookie as seen by the browser (the dev proxy serves the API under /api). */
    /**
     * A token revoked by rotation less than this many seconds ago is treated as a concurrent
     * refresh (e.g. several tabs) rather than theft. 0 disables the grace window.
     */
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
    REFRESH_COOKIE_PATH: z.string().startsWith('/').default('/api/auth'),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(PRODUCTION_MIN_BCRYPT_COST),
    AUTH_RATE_LIMIT_WINDOW_MS: positiveInt.default(15 * 60 * 1000),
    /** Max requests per client IP and window for all /auth/* endpoints. */
    AUTH_RATE_LIMIT_MAX: positiveInt.default(100),
    /** Max requests per client IP and window for login and register (credential guessing). */
    AUTH_CREDENTIALS_RATE_LIMIT_MAX: positiveInt.default(10),
    ...aiEnvShape,
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BCRYPT_COST >= PRODUCTION_MIN_BCRYPT_COST, {
    path: ['BCRYPT_COST'],
    message: `BCRYPT_COST must be at least ${PRODUCTION_MIN_BCRYPT_COST} in production`,
  })
  .superRefine(checkAiEnv);

export type AppConfig = z.infer<typeof envSchema>;
export type AiConfig = z.infer<typeof aiEnvSchema>;

/**
 * Parses and validates configuration from environment variables.
 * Throws with a readable message when the configuration is invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Parses only the AI assistant's configuration (for tools that do not need the database, such as
 * the model smoke test). Throws with a readable message when it is invalid.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const result = aiEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid AI configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
