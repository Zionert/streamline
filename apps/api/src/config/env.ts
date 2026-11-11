import { z } from 'zod';

/** bcrypt work factor required in production. */
export const PRODUCTION_MIN_BCRYPT_COST = 12;

const positiveInt = z.coerce.number().int().positive();

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
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.BCRYPT_COST >= PRODUCTION_MIN_BCRYPT_COST, {
    path: ['BCRYPT_COST'],
    message: `BCRYPT_COST must be at least ${PRODUCTION_MIN_BCRYPT_COST} in production`,
  });

export type AppConfig = z.infer<typeof envSchema>;

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
