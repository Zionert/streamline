import { z } from 'zod';

/**
 * Colors of labels: a fixed palette of names, which clients map to theme-aware colors (the
 * stored value never depends on a theme).
 */
export const LABEL_COLORS = [
  'GREEN',
  'YELLOW',
  'ORANGE',
  'RED',
  'PURPLE',
  'BLUE',
  'SKY',
  'LIME',
  'PINK',
  'GRAY',
] as const;

export const labelColorSchema = z.enum(LABEL_COLORS);

export type LabelColor = z.infer<typeof labelColorSchema>;

export const LABEL_NAME_MAX_LENGTH = 30;

/** Maximum number of labels defined on one board. */
export const LABELS_PER_BOARD_MAX = 50;

/** Maximum number of labels attached to one card. */
export const LABELS_PER_CARD_MAX = 10;

/** Trimmed, 1–30 characters; unique per board regardless of case. */
export const labelNameSchema = z
  .string()
  .trim()
  .min(1, 'Label name is required')
  .max(LABEL_NAME_MAX_LENGTH, `Label name must be at most ${LABEL_NAME_MAX_LENGTH} characters`);

/** Body of `POST /boards/:boardId/labels`. */
export const createLabelSchema = z.strictObject({
  name: labelNameSchema,
  color: labelColorSchema,
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;

/** Body of `PATCH /boards/:boardId/labels/:labelId`; at least one field is required. */
export const updateLabelSchema = z
  .strictObject({
    name: labelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: 'name or color is required',
  });

export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

export const labelSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  name: z.string(),
  color: labelColorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Label = z.infer<typeof labelSchema>;

/** Response body of `POST` and `PATCH` on labels. */
export const labelResponseSchema = z.object({
  label: labelSchema,
});

export type LabelResponse = z.infer<typeof labelResponseSchema>;

/**
 * Response body of `GET /boards/:boardId/labels`: the board's labels in creation order (the same
 * order as `labelIds` of a card).
 */
export const labelListResponseSchema = z.object({
  labels: z.array(labelSchema),
});

export type LabelListResponse = z.infer<typeof labelListResponseSchema>;

/** Error codes specific to the label endpoints (besides the generic ones). */
export const LABEL_ERROR_CODES = {
  /** 404: the label is not a label of this board. */
  LABEL_NOT_FOUND: 'LABEL_NOT_FOUND',
  /** 409: another label of the board has the same name (case-insensitive). */
  LABEL_NAME_TAKEN: 'LABEL_NAME_TAKEN',
  /** 409: the board already has the maximum number of labels. */
  LABEL_LIMIT_REACHED: 'LABEL_LIMIT_REACHED',
  /** 409: the card already carries the maximum number of labels. */
  CARD_LABEL_LIMIT_REACHED: 'CARD_LABEL_LIMIT_REACHED',
} as const;

export type LabelErrorCode = (typeof LABEL_ERROR_CODES)[keyof typeof LABEL_ERROR_CODES];
