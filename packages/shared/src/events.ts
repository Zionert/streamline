/**
 * Socket.io event names broadcast to the `board:<id>` room after a successful REST change.
 * Payload types will be added together with the corresponding features.
 */
export const WS_EVENTS = {
  BOARD_UPDATED: 'board:updated',
  COLUMN_CREATED: 'column:created',
  CARD_MOVED: 'card:moved',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** Builds the Socket.io room name for a board. */
export const boardRoom = (boardId: string): `board:${string}` => `board:${boardId}`;
