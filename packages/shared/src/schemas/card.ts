import { z } from 'zod';

import { rankSchema } from '../rank/keys.js';
import { COLUMN_ERROR_CODES } from './column.js';
import { distinctNeighbors, distinctNeighborsIssue, positionShape } from './position.js';

export const CARD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const cardPrioritySchema = z.enum(CARD_PRIORITIES);

export type CardPriority = z.infer<typeof cardPrioritySchema>;

export const DEFAULT_CARD_PRIORITY: CardPriority = 'MEDIUM';

export const CARD_TITLE_MAX_LENGTH = 200;
export const CARD_DESCRIPTION_MAX_LENGTH = 10_000;

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, 'Card title is required')
  .max(CARD_TITLE_MAX_LENGTH, `Card title must be at most ${CARD_TITLE_MAX_LENGTH} characters`);

/** Trimmed; an empty or whitespace-only description is stored as `null`. */
export const cardDescriptionSchema = z
  .string()
  .trim()
  .max(
    CARD_DESCRIPTION_MAX_LENGTH,
    `Card description must be at most ${CARD_DESCRIPTION_MAX_LENGTH} characters`,
  )
  .transform((value) => (value === '' ? null : value));

/** Due date as a calendar date `YYYY-MM-DD` (no time, no time zone). */
export const cardDueDateSchema = z.iso.date('Due date must be a valid date in YYYY-MM-DD format');

/** Largest card number (the database stores numbers as 32-bit integers). */
export const CARD_NUMBER_MAX = 2_147_483_647;

/** `<board key>-<card number>`, e.g. `SL-12`. */
export const CARD_KEY_PATTERN = /^([A-Z]{2,5})-([1-9]\d*)$/;

/** A card key split into its parts. */
export interface ParsedCardKey {
  boardKey: string;
  number: number;
}

/** Validates a card key (e.g. from a URL) and splits it into the board key and the number. */
export const cardKeySchema = z
  .string()
  .regex(CARD_KEY_PATTERN, 'Card key must look like SL-12')
  .transform((value, ctx): ParsedCardKey => {
    const [, boardKey = '', digits = ''] = CARD_KEY_PATTERN.exec(value) ?? [];
    const number = Number(digits);
    if (number > CARD_NUMBER_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Card number is too large' });
      return z.NEVER;
    }
    return { boardKey, number };
  });

/** Card key shown to users: the board's current key and the card's number. */
export function formatCardKey(boardKey: string, number: number): string {
  return `${boardKey}-${String(number)}`;
}

const userIdSchema = z.string().min(1);

/**
 * Body of `POST /boards/:boardId/cards`. The card is appended at the end of the column and gets
 * the next number of the board. The assignee must be a member of the board.
 */
export const createCardSchema = z.strictObject({
  columnId: z.string().min(1),
  title: cardTitleSchema,
  description: cardDescriptionSchema.nullable().optional(),
  priority: cardPrioritySchema.optional(),
  assigneeId: userIdSchema.nullable().optional(),
  dueDate: cardDueDateSchema.nullable().optional(),
});

export type CreateCardInput = z.infer<typeof createCardSchema>;

/**
 * Body of `PATCH /boards/:boardId/cards/:cardId`; at least one field is required. `null` clears
 * the description, assignee or due date. The column and position change only through `/move`.
 */
export const updateCardSchema = z
  .strictObject({
    title: cardTitleSchema.optional(),
    description: cardDescriptionSchema.nullable().optional(),
    priority: cardPrioritySchema.optional(),
    assigneeId: userIdSchema.nullable().optional(),
    dueDate: cardDueDateSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field is required',
  });

export type UpdateCardInput = z.infer<typeof updateCardSchema>;

/**
 * Body of `PATCH /boards/:boardId/cards/:cardId/move`.
 *
 * - `columnId` — the target column (may be the current one, to reorder).
 * - `afterId` — the card that will directly PRECEDE the moved card (`null` = top of the column).
 * - `beforeId` — the card that will directly FOLLOW the moved card (`null` = bottom).
 *
 * Neighbours must be cards of the target column. Without neighbours the card goes to the bottom.
 * The adjacency rules (409 `INVALID_POSITION` for a stale view, relaxed after a concurrent
 * insert into the same gap) are the same as for moving columns.
 */
export const moveCardSchema = z
  .strictObject({ columnId: z.string().min(1), ...positionShape })
  .refine(distinctNeighbors, distinctNeighborsIssue('cards'));

export type MoveCardInput = z.infer<typeof moveCardSchema>;

export const cardSchema = z.object({
  id: z.string(),
  /** `<board key>-<number>`; follows the board key when it changes. */
  key: z.string().regex(CARD_KEY_PATTERN),
  /** Sequential per board, never reused. */
  number: z.int().min(1).max(CARD_NUMBER_MAX),
  boardId: z.string(),
  columnId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Ordering key within the column; compare with `<` (never `localeCompare`). */
  rank: rankSchema,
  priority: cardPrioritySchema,
  assigneeId: z.string().nullable(),
  dueDate: cardDueDateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Card = z.infer<typeof cardSchema>;

/** Response body of the endpoints returning a single card. */
export const cardResponseSchema = z.object({
  card: cardSchema,
});

export type CardResponse = z.infer<typeof cardResponseSchema>;

/** Cards of one column, in rank order. */
export const columnCardsSchema = z.object({
  columnId: z.string(),
  cards: z.array(cardSchema),
});

export type ColumnCards = z.infer<typeof columnCardsSchema>;

/**
 * Response body of `GET /boards/:boardId/cards`: every column of the board (also empty ones) in
 * rank order, each with its cards in rank order.
 */
export const cardListResponseSchema = z.object({
  columns: z.array(columnCardsSchema),
});

export type CardListResponse = z.infer<typeof cardListResponseSchema>;

/** Error codes specific to the card endpoints (besides the generic ones). */
export const CARD_ERROR_CODES = {
  /** 404: `columnId` is not a column of this board. */
  COLUMN_NOT_FOUND: 'COLUMN_NOT_FOUND',
  /** 404: `afterId` or `beforeId` is not a card of the target column. */
  NEIGHBOR_NOT_FOUND: COLUMN_ERROR_CODES.NEIGHBOR_NOT_FOUND,
  /** 409: `afterId` and `beforeId` are not adjacent: the client's view is stale. */
  INVALID_POSITION: COLUMN_ERROR_CODES.INVALID_POSITION,
  /** 409: concurrent changes kept producing the same rank; the request may be retried. */
  RANK_CONFLICT: COLUMN_ERROR_CODES.RANK_CONFLICT,
  /** 409: the target column has a strict WIP limit and is full. */
  WIP_LIMIT_EXCEEDED: 'WIP_LIMIT_EXCEEDED',
  /** 400: the assignee is not a member of the board. */
  ASSIGNEE_NOT_MEMBER: 'ASSIGNEE_NOT_MEMBER',
  /** 503: too many concurrent changes of the board; nothing was changed, retry later. */
  BOARD_BUSY: COLUMN_ERROR_CODES.BOARD_BUSY,
} as const;

export type CardErrorCode = (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES];
