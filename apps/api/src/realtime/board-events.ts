import type { BoardEventName, BoardEventPayloads } from '@streamline/shared';

/** Where a REST change came from, beyond the authenticated user. */
export interface ChangeOrigin {
  /**
   * Socket.io id the client sent with the request (`X-Socket-Id`). That socket does not receive
   * the resulting event: the client has applied the change already.
   */
  socketId?: string | undefined;
}

/**
 * Broadcasts board changes to the clients viewing the board. Services call it only after the
 * change has been committed; REST works the same without a socket server (`noopBoardEvents`).
 */
export interface BoardEvents {
  /** Sends the event to the board room (`payload.boardId`), except the originating socket. */
  publish<E extends BoardEventName>(
    name: E,
    payload: BoardEventPayloads[E],
    origin?: ChangeOrigin,
  ): void;
  /**
   * The user is no longer a member: their sockets leave the board room, get
   * `board:access-revoked` (except the originating socket, e.g. the tab the user left from) and
   * stop being listed as present.
   */
  revokeAccess(boardId: string, userId: string, origin?: ChangeOrigin): void;
  /** Sends `board:deleted` to the board room and then empties the room. */
  closeBoard(payload: BoardEventPayloads['board:deleted'], origin?: ChangeOrigin): void;
}

export const noopBoardEvents: BoardEvents = {
  publish() {},
  revokeAccess() {},
  closeBoard() {},
};
