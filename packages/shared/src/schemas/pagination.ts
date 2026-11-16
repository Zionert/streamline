import { z } from 'zod';

/**
 * Keyset (cursor) pagination over rows ordered by `(createdAt, id)`. A cursor names the last row
 * of the previous page; it is opaque to clients, which only pass back the `nextCursor` they got.
 */

/** Position of a row in a `(createdAt, id)` order. */
export interface PageCursor {
  createdAt: Date;
  id: string;
}

/** `<createdAt in ms since the epoch>_<id>`; ids are cuids (no `_`). */
const CURSOR_PATTERN = /^(\d{1,16})_([A-Za-z0-9-]{1,64})$/;

/** Encodes the position of a row as a cursor string. */
export function encodePageCursor({ createdAt, id }: PageCursor): string {
  return `${String(createdAt.getTime())}_${id}`;
}

/** Validates a cursor string and decodes it to the position of a row. */
export const pageCursorSchema = z
  .string()
  .regex(CURSOR_PATTERN, 'Invalid cursor')
  .transform((value, ctx): PageCursor => {
    const [, millis = '', id = ''] = CURSOR_PATTERN.exec(value) ?? [];
    const createdAt = new Date(Number(millis));
    if (Number.isNaN(createdAt.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
      return z.NEVER;
    }
    return { createdAt, id };
  });

/**
 * Query string of a paginated list: `cursor` (from the previous page's `nextCursor`) and `limit`
 * (an integer from 1 to `maxLimit`, `defaultLimit` when absent).
 */
export function pageQuerySchema(defaultLimit: number, maxLimit: number) {
  return z.object({
    cursor: pageCursorSchema.optional(),
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(maxLimit, `limit must be at most ${String(maxLimit)}`)
      .default(defaultLimit),
  });
}

export interface PageQuery {
  cursor?: PageCursor | undefined;
  limit: number;
}
