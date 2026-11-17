import { z } from 'zod';

import { rankSchema } from './rank/index.js';
import { activitySchema } from './schemas/activity.js';
import { boardMemberSchema, boardSummarySchema } from './schemas/board.js';
import { cardSchema } from './schemas/card.js';
import { columnSchema } from './schemas/column.js';
import { commentSchema } from './schemas/comment.js';
import { labelSchema } from './schemas/label.js';

/**
 * Real-time protocol (Socket.io). REST is the only write path: the server broadcasts these events
 * to the `board:<id>` room after a successful REST change, and clients only join/leave rooms.
 */

/** Events broadcast by the server. */
export const WS_EVENTS = {
  /** Name or key of the board changed (card keys follow the board key). */
  BOARD_UPDATED: 'board:updated',
  /** The board was deleted; every socket is removed from its room afterwards. */
  BOARD_DELETED: 'board:deleted',
  /** Sent to the sockets of a user who is no longer a member (removed or left). */
  BOARD_ACCESS_REVOKED: 'board:access-revoked',
  COLUMN_CREATED: 'column:created',
  /** Rename or settings (category, WIP limit, strict mode). */
  COLUMN_UPDATED: 'column:updated',
  COLUMN_MOVED: 'column:moved',
  COLUMN_DELETED: 'column:deleted',
  /** The server gave new ranks to many columns of the board at once. */
  COLUMNS_REBALANCED: 'columns:rebalanced',
  CARD_CREATED: 'card:created',
  /**
   * Fields of a card changed (title, description, priority, assignee, due date) or a label was
   * attached to / removed from it (`labelIds`).
   */
  CARD_UPDATED: 'card:updated',
  CARD_MOVED: 'card:moved',
  CARD_DELETED: 'card:deleted',
  /** The server gave new ranks to many cards of one column at once. */
  CARDS_REBALANCED: 'cards:rebalanced',
  MEMBER_ADDED: 'member:added',
  MEMBER_UPDATED: 'member:updated',
  MEMBER_REMOVED: 'member:removed',
  LABEL_CREATED: 'label:created',
  /** Name or color of a label changed. */
  LABEL_UPDATED: 'label:updated',
  /** The label was deleted and removed from every card of the board. */
  LABEL_DELETED: 'label:deleted',
  COMMENT_CREATED: 'comment:created',
  /** The author edited the comment. */
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  /**
   * A new activity log entry. Unlike the other events it is also delivered to the socket that
   * made the change (see {@link isEchoSuppressed}), whose feed needs it as well.
   */
  ACTIVITY_CREATED: 'activity:created',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** Events emitted by the client (each with an acknowledgement callback). */
export const WS_CLIENT_EVENTS = {
  BOARD_JOIN: 'board:join',
  BOARD_LEAVE: 'board:leave',
} as const;

/**
 * Request header carrying the Socket.io id of the client that sends a REST change. The server
 * does not send the resulting event back to that socket (the client has applied the change
 * already), provided the socket belongs to the authenticated user.
 */
export const SOCKET_ID_HEADER = 'X-Socket-Id';

/** Error codes of the handshake (`connect_error` → `err.data.code`) and of acknowledgements. */
export const WS_ERROR_CODES = {
  /** No, malformed or invalid access token, or the user no longer exists. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** The access token has expired: refresh the session and connect again. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** The board does not exist or the user is not a member of it. */
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type WsErrorCode = (typeof WS_ERROR_CODES)[keyof typeof WS_ERROR_CODES];

/** Builds the Socket.io room name for a board. */
export const boardRoom = (boardId: string): `board:${string}` => `board:${boardId}`;

/** Builds the Socket.io room name grouping all sockets of a user. */
export const userRoom = (userId: string): `user:${string}` => `user:${userId}`;

// --- Client → server ---

/** Payload of `board:join` and `board:leave`. */
export const boardRoomRequestSchema = z.strictObject({
  boardId: z.string().min(1).max(64),
});

export type BoardRoomRequest = z.infer<typeof boardRoomRequestSchema>;

export const wsErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export type WsError = z.infer<typeof wsErrorSchema>;

/** Acknowledgement of `board:join`. */
export const boardJoinAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: wsErrorSchema }),
]);

export type BoardJoinAck = z.infer<typeof boardJoinAckSchema>;

/** Acknowledgement of `board:leave`. */
export const boardLeaveAckSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: wsErrorSchema }),
]);

export type BoardLeaveAck = z.infer<typeof boardLeaveAckSchema>;

// --- Server → client ---

/** Fields of every event caused by a REST change: the board and the user who made the change. */
const changeEventShape = {
  boardId: z.string(),
  actorId: z.string(),
};

const rankAssignmentSchema = z.object({ id: z.string(), rank: rankSchema });

export type RankAssignmentPayload = z.infer<typeof rankAssignmentSchema>;

const columnEventSchema = z.object({ ...changeEventShape, column: columnSchema });
const cardEventSchema = z.object({ ...changeEventShape, card: cardSchema });
const memberEventSchema = z.object({ ...changeEventShape, member: boardMemberSchema });
const labelEventSchema = z.object({ ...changeEventShape, label: labelSchema });
const commentEventSchema = z.object({ ...changeEventShape, comment: commentSchema });

/**
 * Payload schemas of the events broadcast to a board room. Entities have the same shape as in
 * the REST responses; deletions carry ids only.
 */
export const boardEventSchemas = {
  [WS_EVENTS.BOARD_UPDATED]: z.object({ ...changeEventShape, board: boardSummarySchema }),
  [WS_EVENTS.BOARD_DELETED]: z.object(changeEventShape),
  [WS_EVENTS.COLUMN_CREATED]: columnEventSchema,
  [WS_EVENTS.COLUMN_UPDATED]: columnEventSchema,
  [WS_EVENTS.COLUMN_MOVED]: columnEventSchema,
  [WS_EVENTS.COLUMN_DELETED]: z.object({ ...changeEventShape, columnId: z.string() }),
  [WS_EVENTS.COLUMNS_REBALANCED]: z.object({
    ...changeEventShape,
    ranks: z.array(rankAssignmentSchema),
  }),
  [WS_EVENTS.CARD_CREATED]: cardEventSchema,
  [WS_EVENTS.CARD_UPDATED]: cardEventSchema,
  [WS_EVENTS.CARD_MOVED]: cardEventSchema,
  [WS_EVENTS.CARD_DELETED]: z.object({ ...changeEventShape, cardId: z.string() }),
  [WS_EVENTS.CARDS_REBALANCED]: z.object({
    ...changeEventShape,
    columnId: z.string(),
    ranks: z.array(rankAssignmentSchema),
  }),
  [WS_EVENTS.MEMBER_ADDED]: memberEventSchema,
  [WS_EVENTS.MEMBER_UPDATED]: memberEventSchema,
  [WS_EVENTS.MEMBER_REMOVED]: z.object({ ...changeEventShape, userId: z.string() }),
  [WS_EVENTS.LABEL_CREATED]: labelEventSchema,
  [WS_EVENTS.LABEL_UPDATED]: labelEventSchema,
  [WS_EVENTS.LABEL_DELETED]: z.object({ ...changeEventShape, labelId: z.string() }),
  [WS_EVENTS.COMMENT_CREATED]: commentEventSchema,
  [WS_EVENTS.COMMENT_UPDATED]: commentEventSchema,
  [WS_EVENTS.COMMENT_DELETED]: z.object({
    ...changeEventShape,
    cardId: z.string(),
    commentId: z.string(),
  }),
  [WS_EVENTS.ACTIVITY_CREATED]: z.object({ ...changeEventShape, activity: activitySchema }),
} as const;

type BoardEventSchemas = typeof boardEventSchemas;

/** Events broadcast to a board room after a REST change. */
export type BoardEventName = keyof BoardEventSchemas;

export type BoardEventPayloads = {
  [K in BoardEventName]: z.infer<BoardEventSchemas[K]>;
};

/** A board event together with its name (a discriminated union, e.g. for a reducer). */
export type BoardEvent = {
  [K in BoardEventName]: { name: K; payload: BoardEventPayloads[K] };
}[BoardEventName];

export const BOARD_EVENT_NAMES = Object.keys(boardEventSchemas) as BoardEventName[];

/**
 * Events sent to every socket in the room, including the one that made the change. The others
 * skip the originating socket (`X-Socket-Id`), whose client has applied the change already; an
 * activity entry, however, is created by the server, so the originating client learns about it
 * only from the event.
 */
export const ECHOED_BOARD_EVENTS: ReadonlySet<BoardEventName> = new Set<BoardEventName>([
  WS_EVENTS.ACTIVITY_CREATED,
]);

/** Whether the event is withheld from the socket that made the change. */
export function isEchoSuppressed(name: BoardEventName): boolean {
  return !ECHOED_BOARD_EVENTS.has(name);
}

function isBoardEventName(name: string): name is BoardEventName {
  return Object.hasOwn(boardEventSchemas, name);
}

/** Validates a received board event; `null` for other events or a malformed payload. */
export function parseBoardEvent(name: string, payload: unknown): BoardEvent | null {
  if (!isBoardEventName(name)) return null;
  const result = boardEventSchemas[name].safeParse(payload);
  // The schema was picked by `name`, so the parsed payload belongs to that event.
  return result.success ? ({ name, payload: result.data } as BoardEvent) : null;
}

export const accessRevokedEventSchema = z.object({ boardId: z.string() });

export type AccessRevokedEvent = z.infer<typeof accessRevokedEventSchema>;

/** Socket.io typing of the events sent by the server. */
export type ServerToClientEvents = {
  [K in BoardEventName]: (payload: BoardEventPayloads[K]) => void;
} & {
  [WS_EVENTS.BOARD_ACCESS_REVOKED]: (payload: AccessRevokedEvent) => void;
};

/** Socket.io typing of the events sent by the client. */
export interface ClientToServerEvents {
  [WS_CLIENT_EVENTS.BOARD_JOIN]: (
    payload: BoardRoomRequest,
    ack: (ack: BoardJoinAck) => void,
  ) => void;
  [WS_CLIENT_EVENTS.BOARD_LEAVE]: (
    payload: BoardRoomRequest,
    ack: (ack: BoardLeaveAck) => void,
  ) => void;
}
