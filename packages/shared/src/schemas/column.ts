import { z } from 'zod';

import { rankSchema } from '../rank/keys.js';
import { distinctNeighbors, distinctNeighborsIssue, positionShape } from './position.js';

/**
 * Workflow category of a column. Flow analytics and WIP rules look at the category, never at
 * the (freely editable) title.
 */
export const COLUMN_CATEGORIES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE'] as const;

export const columnCategorySchema = z.enum(COLUMN_CATEGORIES);

export type ColumnCategory = z.infer<typeof columnCategorySchema>;

export const COLUMN_TITLE_MAX_LENGTH = 100;

export const columnTitleSchema = z
  .string()
  .trim()
  .min(1, 'Column title is required')
  .max(
    COLUMN_TITLE_MAX_LENGTH,
    `Column title must be at most ${COLUMN_TITLE_MAX_LENGTH} characters`,
  );

export const COLUMN_WIP_LIMIT_MIN = 1;
export const COLUMN_WIP_LIMIT_MAX = 999;

/** Maximum number of cards in a column; `null` (in settings) means no limit. */
export const columnWipLimitSchema = z.int().min(COLUMN_WIP_LIMIT_MIN).max(COLUMN_WIP_LIMIT_MAX);

/** Columns created together with every new board, in board order. */
export const DEFAULT_BOARD_COLUMNS: readonly { title: string; category: ColumnCategory }[] = [
  { title: 'Backlog', category: 'BACKLOG' },
  { title: 'To Do', category: 'TODO' },
  { title: 'In Progress', category: 'IN_PROGRESS' },
  { title: 'Done', category: 'DONE' },
];

/**
 * Position of a column relative to its future neighbours. The server computes the `rank`
 * from the persisted ranks of these neighbours; clients never send ranks.
 *
 * - `afterId` — the column that will directly PRECEDE the column; `null` = it becomes first.
 * - `beforeId` — the column that will directly FOLLOW the column; `null` = it becomes last.
 *
 * With only one of them, the other neighbour is whatever currently sits next to it. When both
 * are given they must be adjacent in the current order (ignoring the moved column itself),
 * otherwise the client's view is stale and the request fails with `INVALID_POSITION`.
 * Exception: if a concurrent change fills the same gap while the request is being processed,
 * the server retries with a relaxed check — `afterId` only has to precede `beforeId` (a reversed
 * pair still fails with `INVALID_POSITION`) and the column is placed directly after `afterId`.
 * Neighbours must belong to the same board and must not be the moved column.
 */
const distinctColumnsIssue = distinctNeighborsIssue('columns');

/**
 * Body of `POST /boards/:boardId/columns`. Without `afterId`/`beforeId` the column is appended
 * at the end; the position fields follow the rules described for {@link moveColumnSchema}.
 * New columns get category `TODO` and no WIP limit.
 */
export const createColumnSchema = z
  .strictObject({ title: columnTitleSchema, ...positionShape })
  .refine(distinctNeighbors, distinctColumnsIssue);

export type CreateColumnInput = z.infer<typeof createColumnSchema>;

/** Body of `PATCH /boards/:boardId/columns/:columnId`. */
export const renameColumnSchema = z.strictObject({
  title: columnTitleSchema,
});

export type RenameColumnInput = z.infer<typeof renameColumnSchema>;

/**
 * Body of `PATCH /boards/:boardId/columns/:columnId/move`; at least one of `afterId` and
 * `beforeId` is required (either may be `null`, meaning the start or the end of the list).
 *
 * - `afterId` — the column that will directly PRECEDE the moved column (`null` = move to start).
 * - `beforeId` — the column that will directly FOLLOW the moved column (`null` = move to end).
 *
 * When both are given they must be adjacent in the current order, ignoring the moved column
 * itself; otherwise the server answers 409 `INVALID_POSITION` (the client's view is stale).
 * If a concurrent change fills the same gap meanwhile, the server only requires `afterId` to
 * precede `beforeId` and places the column directly after `afterId`.
 */
export const moveColumnSchema = z
  .strictObject(positionShape)
  .refine((value) => value.afterId !== undefined || value.beforeId !== undefined, {
    message: 'afterId or beforeId is required',
  })
  .refine(distinctNeighbors, distinctColumnsIssue);

export type MoveColumnInput = z.infer<typeof moveColumnSchema>;

/** Body of `PATCH /boards/:boardId/columns/:columnId/settings`; at least one field is required. */
export const updateColumnSettingsSchema = z
  .strictObject({
    category: columnCategorySchema.optional(),
    /** `null` removes the limit. */
    wipLimit: columnWipLimitSchema.nullable().optional(),
    /** When true, the WIP limit blocks adding cards instead of only warning. */
    wipStrict: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.category !== undefined || value.wipLimit !== undefined || value.wipStrict !== undefined,
    { message: 'At least one setting is required' },
  );

export type UpdateColumnSettingsInput = z.infer<typeof updateColumnSettingsSchema>;

export const columnSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  title: z.string(),
  /** Ordering key; compare with `<` (never `localeCompare`). */
  rank: rankSchema,
  category: columnCategorySchema,
  wipLimit: columnWipLimitSchema.nullable(),
  wipStrict: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Column = z.infer<typeof columnSchema>;

/** Response body of the endpoints returning a single column. */
export const columnResponseSchema = z.object({
  column: columnSchema,
});

export type ColumnResponse = z.infer<typeof columnResponseSchema>;

/** Response body of `GET /boards/:boardId/columns`; columns are ordered by rank. */
export const columnListResponseSchema = z.object({
  columns: z.array(columnSchema),
});

export type ColumnListResponse = z.infer<typeof columnListResponseSchema>;

/** Error codes specific to the column endpoints (besides the generic ones). */
export const COLUMN_ERROR_CODES = {
  /** `afterId` or `beforeId` is not a column of this board (or was deleted meanwhile). */
  NEIGHBOR_NOT_FOUND: 'NEIGHBOR_NOT_FOUND',
  /** `afterId` and `beforeId` are not adjacent: the client's view of the board is stale. */
  INVALID_POSITION: 'INVALID_POSITION',
  /** Concurrent changes kept producing the same rank; the request may be retried. */
  RANK_CONFLICT: 'RANK_CONFLICT',
  /** The board must keep at least one column with category DONE. */
  LAST_DONE_COLUMN: 'LAST_DONE_COLUMN',
  /** The column still holds cards; move or delete them first. */
  COLUMN_NOT_EMPTY: 'COLUMN_NOT_EMPTY',
  /**
   * 503: too many concurrent changes of the board's columns; nothing was changed and the
   * request may be retried after a short pause.
   */
  BOARD_BUSY: 'BOARD_BUSY',
} as const;

export type ColumnErrorCode = (typeof COLUMN_ERROR_CODES)[keyof typeof COLUMN_ERROR_CODES];
