import { z } from 'zod';

import { BOARD_KEY_PATTERN } from '../board-key.js';
import { emailSchema } from './auth.js';

/** Roles of a board member, from the most to the least privileged. */
export const BOARD_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

export const boardRoleSchema = z.enum(BOARD_ROLES);

export type BoardRole = z.infer<typeof boardRoleSchema>;

/**
 * Roles that can be granted through the member endpoints. OWNER is never assignable there:
 * a board always has exactly one owner, set when the board is created.
 */
export const ASSIGNABLE_BOARD_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const;

export const assignableBoardRoleSchema = z.enum(ASSIGNABLE_BOARD_ROLES);

export type AssignableBoardRole = z.infer<typeof assignableBoardRoleSchema>;

export const BOARD_NAME_MAX_LENGTH = 100;

export const boardNameSchema = z
  .string()
  .trim()
  .min(1, 'Board name is required')
  .max(BOARD_NAME_MAX_LENGTH, `Board name must be at most ${BOARD_NAME_MAX_LENGTH} characters`);

/** Body of `POST /boards`. */
export const createBoardSchema = z.object({
  name: boardNameSchema,
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;

/**
 * Board key, the prefix of card keys (`SL` in `SL-12`): 2–5 uppercase ASCII letters, unique among
 * the boards of one owner. Input is trimmed and uppercased.
 */
export const boardKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BOARD_KEY_PATTERN, 'Board key must be 2-5 letters A-Z');

/** Board name alone, e.g. for a rename form. */
export const renameBoardSchema = z.object({
  name: boardNameSchema,
});

export type RenameBoardInput = z.infer<typeof renameBoardSchema>;

/**
 * Body of `PATCH /boards/:boardId`; at least one field is required. Changing the key changes
 * the keys of all cards of the board (their numbers stay the same).
 */
export const updateBoardSchema = z
  .strictObject({
    name: boardNameSchema.optional(),
    key: boardKeySchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.key !== undefined, {
    message: 'name or key is required',
  });

export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

/** Body of `POST /boards/:boardId/members`; the user must already have an account. */
export const addBoardMemberSchema = z.object({
  email: emailSchema,
  role: assignableBoardRoleSchema.default('MEMBER'),
});

export type AddBoardMemberInput = z.infer<typeof addBoardMemberSchema>;

/** Body of `PATCH /boards/:boardId/members/:userId`. */
export const updateBoardMemberSchema = z.object({
  role: assignableBoardRoleSchema,
});

export type UpdateBoardMemberInput = z.infer<typeof updateBoardMemberSchema>;

/** A board as seen by the current user, including the user's role on it. */
export const boardSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: boardKeySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  role: boardRoleSchema,
});

export type Board = z.infer<typeof boardSchema>;

/** Response body of `POST /boards`, `GET /boards/:boardId` and `PATCH /boards/:boardId`. */
export const boardResponseSchema = z.object({
  board: boardSchema,
});

export type BoardResponse = z.infer<typeof boardResponseSchema>;

/** Response body of `GET /boards`. */
export const boardListResponseSchema = z.object({
  boards: z.array(boardSchema),
});

export type BoardListResponse = z.infer<typeof boardListResponseSchema>;

export const boardMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  role: boardRoleSchema,
  joinedAt: z.iso.datetime(),
});

export type BoardMember = z.infer<typeof boardMemberSchema>;

/** Response body of `POST /boards/:boardId/members` and `PATCH /boards/:boardId/members/:userId`. */
export const boardMemberResponseSchema = z.object({
  member: boardMemberSchema,
});

export type BoardMemberResponse = z.infer<typeof boardMemberResponseSchema>;

/** Response body of `GET /boards/:boardId/members`. */
export const boardMemberListResponseSchema = z.object({
  members: z.array(boardMemberSchema),
});

export type BoardMemberListResponse = z.infer<typeof boardMemberListResponseSchema>;

/** Error codes specific to the board endpoints (besides the generic ones). */
export const BOARD_ERROR_CODES = {
  /** No registered user has the given email. */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  /** The user is already a member of the board. */
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  /** The owner tried to leave the board; ownership has to be transferred first. */
  OWNER_CANNOT_LEAVE: 'OWNER_CANNOT_LEAVE',
  /** Another board of the same owner already uses the requested key. */
  BOARD_KEY_TAKEN: 'BOARD_KEY_TAKEN',
} as const;

export type BoardErrorCode = (typeof BOARD_ERROR_CODES)[keyof typeof BOARD_ERROR_CODES];
