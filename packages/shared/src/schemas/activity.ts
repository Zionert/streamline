import { z } from 'zod';

import { boardRoleSchema } from './board.js';
import { columnCategorySchema, columnWipLimitSchema } from './column.js';
import { labelColorSchema } from './label.js';
import { pageQuerySchema } from './pagination.js';
import { userRefSchema } from './user-ref.js';

/**
 * Board activity log ("who did what, when"). Every entry is written by the server in the same
 * transaction as the change it describes. The payload is a self-describing snapshot (names and
 * titles at the time of the change), so the feed renders without looking up rows that may have
 * been renamed or deleted since.
 */
export const ACTIVITY_TYPES = [
  'CARD_CREATED',
  /** Fields of a card changed (only the names of the fields; the old and new title as well). */
  'CARD_UPDATED',
  /** The card entered another column (reordering within a column is not recorded). */
  'CARD_MOVED',
  'CARD_DELETED',
  'CARD_LABEL_ADDED',
  'CARD_LABEL_REMOVED',
  'COMMENT_ADDED',
  'COLUMN_CREATED',
  'COLUMN_RENAMED',
  'COLUMN_MOVED',
  /** Category, WIP limit or strict mode changed. */
  'COLUMN_SETTINGS_CHANGED',
  'COLUMN_DELETED',
  'MEMBER_ADDED',
  'MEMBER_ROLE_CHANGED',
  /** A manager removed the member. */
  'MEMBER_REMOVED',
  /** The member left the board on their own. */
  'MEMBER_LEFT',
] as const;

export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

export type ActivityType = z.infer<typeof activityTypeSchema>;

/** Entries returned per page when the request gives no `limit`. */
export const ACTIVITY_PAGE_DEFAULT_LIMIT = 30;
export const ACTIVITY_PAGE_MAX_LIMIT = 100;

/** Card fields reported by `CARD_UPDATED` (names as in the card API). */
export const ACTIVITY_CARD_FIELDS = [
  'title',
  'description',
  'priority',
  'assigneeId',
  'dueDate',
] as const;

export const activityCardFieldSchema = z.enum(ACTIVITY_CARD_FIELDS);

export type ActivityCardField = z.infer<typeof activityCardFieldSchema>;

/** A card as it was at the time of the entry. */
export const activityCardSchema = z.object({
  key: z.string(),
  title: z.string(),
});

/** A column as it was at the time of the entry. */
export const activityColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** A label as it was at the time of the entry. */
export const activityLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: labelColorSchema,
});

/** An old and a new value. */
function change<T extends z.ZodType>(value: T) {
  return z.object({ from: value, to: value });
}

const cardInColumn = z.object({ card: activityCardSchema, column: activityColumnSchema });
const columnOnly = z.object({ column: activityColumnSchema });
const cardLabel = z.object({ card: activityCardSchema, label: activityLabelSchema });
const memberWithRole = z.object({ member: userRefSchema, role: boardRoleSchema });

/** Column settings that changed (at least one). */
export const activityColumnSettingsChangesSchema = z
  .object({
    category: change(columnCategorySchema).optional(),
    wipLimit: change(columnWipLimitSchema.nullable()).optional(),
    wipStrict: change(z.boolean()).optional(),
  })
  .refine(
    (value) =>
      value.category !== undefined || value.wipLimit !== undefined || value.wipStrict !== undefined,
    { message: 'At least one setting change is required' },
  );

/** Payload schema of each activity type. */
export const activityPayloadSchemas = {
  CARD_CREATED: cardInColumn,
  CARD_UPDATED: z.object({
    card: activityCardSchema,
    /** Fields whose value changed, in {@link ACTIVITY_CARD_FIELDS} order. */
    fields: z.array(activityCardFieldSchema).min(1),
    /** Present when the title changed (`card.title` is the new one). */
    title: change(z.string()).optional(),
  }),
  CARD_MOVED: z.object({
    card: activityCardSchema,
    from: activityColumnSchema,
    to: activityColumnSchema,
  }),
  /** `column` is the column the card was in. */
  CARD_DELETED: cardInColumn,
  CARD_LABEL_ADDED: cardLabel,
  CARD_LABEL_REMOVED: cardLabel,
  COMMENT_ADDED: z.object({ card: activityCardSchema, commentId: z.string() }),
  COLUMN_CREATED: columnOnly,
  /** `column.name` is the new name. */
  COLUMN_RENAMED: z.object({ column: activityColumnSchema, name: change(z.string()) }),
  COLUMN_MOVED: columnOnly,
  COLUMN_SETTINGS_CHANGED: z.object({
    column: activityColumnSchema,
    changes: activityColumnSettingsChangesSchema,
  }),
  COLUMN_DELETED: columnOnly,
  /** `role` is the role the member was given. */
  MEMBER_ADDED: memberWithRole,
  MEMBER_ROLE_CHANGED: z.object({ member: userRefSchema, role: change(boardRoleSchema) }),
  /** `role` is the role the member had. */
  MEMBER_REMOVED: memberWithRole,
  MEMBER_LEFT: memberWithRole,
} as const satisfies Record<ActivityType, z.ZodType>;

type ActivityPayloadSchemas = typeof activityPayloadSchemas;

export type ActivityPayloads = {
  [K in ActivityType]: z.infer<ActivityPayloadSchemas[K]>;
};

function variant<T extends ActivityType>(type: T) {
  return z.object({ type: z.literal(type), payload: activityPayloadSchemas[type] });
}

/** The type of an entry together with its payload (a discriminated union on `type`). */
export const activityContentSchema = z.discriminatedUnion('type', [
  variant('CARD_CREATED'),
  variant('CARD_UPDATED'),
  variant('CARD_MOVED'),
  variant('CARD_DELETED'),
  variant('CARD_LABEL_ADDED'),
  variant('CARD_LABEL_REMOVED'),
  variant('COMMENT_ADDED'),
  variant('COLUMN_CREATED'),
  variant('COLUMN_RENAMED'),
  variant('COLUMN_MOVED'),
  variant('COLUMN_SETTINGS_CHANGED'),
  variant('COLUMN_DELETED'),
  variant('MEMBER_ADDED'),
  variant('MEMBER_ROLE_CHANGED'),
  variant('MEMBER_REMOVED'),
  variant('MEMBER_LEFT'),
]);

export type ActivityContent = z.infer<typeof activityContentSchema>;

/** Fields of every activity entry, whatever its type. */
export const activityBaseSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  /** The card the entry is about (it may have been deleted since); `null` for other entries. */
  cardId: z.string().nullable(),
  /** Who made the change; `null` when the account no longer exists. */
  actor: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});

/** An activity entry as returned by the API and carried by `activity:created`. */
export const activitySchema = z.intersection(activityBaseSchema, activityContentSchema);

export type Activity = z.infer<typeof activitySchema>;

/**
 * Query of the activity feeds: newest first, `limit` per page (default 30, at most 100), `cursor`
 * from the previous page.
 */
export const activityListQuerySchema = pageQuerySchema(
  ACTIVITY_PAGE_DEFAULT_LIMIT,
  ACTIVITY_PAGE_MAX_LIMIT,
);

export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

/**
 * Response body of `GET /boards/:boardId/activity` and `GET /boards/:boardId/cards/:cardId/activity`:
 * one page of entries, newest first; `nextCursor` is `null` on the last page.
 */
export const activityListResponseSchema = z.object({
  activities: z.array(activitySchema),
  nextCursor: z.string().nullable(),
});

export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;
