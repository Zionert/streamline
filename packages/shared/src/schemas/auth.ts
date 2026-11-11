import { z } from 'zod';

/** bcrypt only uses the first 72 bytes of a password; longer input would be silently truncated. */
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_MIN_LENGTH = 8;
export const NAME_MAX_LENGTH = 100;

/** Length of the string in UTF-8 bytes (no dependency on DOM or Node typings). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) bytes += 1;
    else if (codePoint < 0x800) bytes += 2;
    else if (codePoint < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Email trimmed and lowercased before validation, so it is stored and compared in normalized form. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

const maxPasswordBytes = (value: string) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES;
const maxPasswordBytesMessage = `Password must be at most ${PASSWORD_MAX_BYTES} bytes long`;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
  .refine(maxPasswordBytes, { message: maxPasswordBytesMessage });

/** Body of `POST /auth/register`. */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name is required').max(NAME_MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Body of `POST /auth/login`. The minimum length is not enforced, so the response reveals nothing
 * about the password policy; the byte cap matches bcrypt, which would silently truncate longer input.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Password is required')
    .refine(maxPasswordBytes, { message: maxPasswordBytesMessage }),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** User data that is safe to expose to clients. */
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

/** Response body of `POST /auth/register`, `POST /auth/login` and `POST /auth/refresh`. */
export const authResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: publicUserSchema,
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Response body of `GET /auth/me`. */
export const meResponseSchema = z.object({
  user: publicUserSchema,
});

export type MeResponse = z.infer<typeof meResponseSchema>;
