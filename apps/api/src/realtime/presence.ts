import type { PresenceUser } from '@streamline/shared';

/**
 * Who is currently viewing which board, kept in the memory of this process (one API instance).
 * A user is present on a board while at least one of their sockets is in the board room, so a
 * user with several tabs is listed once.
 */
export interface PresenceTracker {
  /** Records that the socket joined the board; `true` when the board's user list changed. */
  join(boardId: string, socketId: string, user: PresenceUser): boolean;
  /** Records that the socket left the board; `true` when the board's user list changed. */
  leave(boardId: string, socketId: string): boolean;
  /** Removes the socket from every board (it disconnected); returns the boards whose list changed. */
  leaveAll(socketId: string): string[];
  /** Removes all sockets of the user from the board; `true` when the user was present. */
  removeUser(boardId: string, userId: string): boolean;
  /** Forgets the board (it was deleted). */
  clearBoard(boardId: string): void;
  /** Users present on the board, each once, in the order they arrived. */
  list(boardId: string): PresenceUser[];
}

interface PresentUser {
  user: PresenceUser;
  socketIds: Set<string>;
}

export function createPresenceTracker(): PresenceTracker {
  /** boardId → userId → the user and their sockets in the board room (insertion-ordered). */
  const boards = new Map<string, Map<string, PresentUser>>();
  /** socketId → boards it is present on (to clean up on disconnect). */
  const socketBoards = new Map<string, Set<string>>();

  function untrackSocketBoard(socketId: string, boardId: string): void {
    const set = socketBoards.get(socketId);
    if (!set) return;
    set.delete(boardId);
    if (set.size === 0) socketBoards.delete(socketId);
  }

  function leave(boardId: string, socketId: string): boolean {
    untrackSocketBoard(socketId, boardId);
    const users = boards.get(boardId);
    if (!users) return false;
    for (const [userId, entry] of users) {
      if (!entry.socketIds.delete(socketId)) continue;
      if (entry.socketIds.size > 0) return false;
      users.delete(userId);
      if (users.size === 0) boards.delete(boardId);
      return true;
    }
    return false;
  }

  return {
    join(boardId, socketId, user) {
      let users = boards.get(boardId);
      if (!users) {
        users = new Map();
        boards.set(boardId, users);
      }
      let boardSet = socketBoards.get(socketId);
      if (!boardSet) {
        boardSet = new Set();
        socketBoards.set(socketId, boardSet);
      }
      boardSet.add(boardId);

      const existing = users.get(user.id);
      if (existing) {
        existing.socketIds.add(socketId);
        return false;
      }
      users.set(user.id, { user, socketIds: new Set([socketId]) });
      return true;
    },

    leave,

    leaveAll(socketId) {
      const boardIds = [...(socketBoards.get(socketId) ?? [])];
      return boardIds.filter((boardId) => leave(boardId, socketId));
    },

    removeUser(boardId, userId) {
      const users = boards.get(boardId);
      const entry = users?.get(userId);
      if (!users || !entry) return false;
      for (const socketId of entry.socketIds) {
        untrackSocketBoard(socketId, boardId);
      }
      users.delete(userId);
      if (users.size === 0) boards.delete(boardId);
      return true;
    },

    clearBoard(boardId) {
      const users = boards.get(boardId);
      if (!users) return;
      for (const entry of users.values()) {
        for (const socketId of entry.socketIds) {
          untrackSocketBoard(socketId, boardId);
        }
      }
      boards.delete(boardId);
    },

    list(boardId) {
      return [...(boards.get(boardId)?.values() ?? [])].map((entry) => entry.user);
    },
  };
}
