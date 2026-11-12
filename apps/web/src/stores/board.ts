import {
  BOARD_ROLES,
  type AddBoardMemberInput,
  type AssignableBoardRole,
  type Board,
  type BoardMember,
  type Column,
  type UpdateColumnSettingsInput,
} from '@streamline/shared';
import { create } from 'zustand';

import {
  getBoardErrorMessage,
  isNotFoundError,
  isStaleColumnsError,
} from '@/features/boards/boardErrorMessage';
import * as boardsApi from '@/features/boards/boardsApi';
import {
  getMoveNeighbors,
  rankFitsAt,
  reorderList,
  restoreOriginalPosition,
  sortByRank,
} from '@/features/boards/columnOrder';
import * as columnsApi from '@/features/boards/columnsApi';
import { useAuthStore } from '@/stores/auth';

export type BoardsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CurrentBoardStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

export interface BoardState {
  /** Boards of the current user (newest first), each with the user's role. */
  boards: Board[];
  boardsStatus: BoardsStatus;
  boardsError: string | null;

  /** Id of the opened board (set as soon as loading starts). */
  boardId: string | null;
  /** The opened board; `board.role` is the current user's role on it. */
  board: Board | null;
  boardStatus: CurrentBoardStatus;
  boardError: string | null;
  /** Columns of the opened board in display order (sorted by rank, except during a move). */
  columns: Column[];
  members: BoardMember[];
  /** A column move (and the reload that may follow) is in progress; further drags wait for it. */
  isMovingColumn: boolean;
  /** Message about a failed operation that has no form of its own (e.g. drag & drop). */
  notice: string | null;

  loadBoards: () => Promise<void>;
  createBoard: (name: string) => Promise<Board>;
  renameBoard: (boardId: string, name: string) => Promise<Board>;
  deleteBoard: (boardId: string) => Promise<void>;

  openBoard: (boardId: string) => Promise<void>;
  /** Reloads the columns of the opened board from the server; never rejects. */
  reloadColumns: () => Promise<void>;
  createColumn: (title: string) => Promise<Column>;
  /** Renames optimistically; restores the previous title and rethrows on failure. */
  renameColumn: (columnId: string, title: string) => Promise<void>;
  /**
   * Moves a column to `toIndex` optimistically; never rejects. On failure the previous order is
   * restored and `notice` is set; a stale view or a server-side rebalance triggers a reload.
   */
  moveColumn: (columnId: string, toIndex: number) => Promise<void>;
  updateColumnSettings: (columnId: string, input: UpdateColumnSettingsInput) => Promise<Column>;
  deleteColumn: (columnId: string) => Promise<void>;

  addMember: (input: AddBoardMemberInput) => Promise<BoardMember>;
  updateMemberRole: (userId: string, role: AssignableBoardRole) => Promise<BoardMember>;
  removeMember: (userId: string) => Promise<void>;
  /** Removes the current user from the opened board and forgets the board locally. */
  leaveBoard: () => Promise<void>;
  dismissNotice: () => void;
}

type BoardData = Pick<
  BoardState,
  | 'boards'
  | 'boardsStatus'
  | 'boardsError'
  | 'boardId'
  | 'board'
  | 'boardStatus'
  | 'boardError'
  | 'columns'
  | 'members'
  | 'isMovingColumn'
  | 'notice'
>;

const openedBoardInitialState: Omit<BoardData, 'boards' | 'boardsStatus' | 'boardsError'> = {
  boardId: null,
  board: null,
  boardStatus: 'idle',
  boardError: null,
  columns: [],
  members: [],
  isMovingColumn: false,
  notice: null,
};

const initialState: BoardData = {
  boards: [],
  boardsStatus: 'idle',
  boardsError: null,
  ...openedBoardInitialState,
};

/**
 * Incremented whenever the opened board changes or the store is reset. Requests started under
 * an older value drop their results, so a slow response never lands on another board or session.
 */
let boardGeneration = 0;
/** The same guard for the board list. */
let boardsGeneration = 0;

/** Members ordered like the API returns them: by role, then (stable) by joining order. */
function sortMembers(members: readonly BoardMember[]): BoardMember[] {
  return [...members].sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role));
}

function requireOpenedBoardId(boardId: string | null): string {
  if (boardId === null) {
    throw new Error('No board is opened');
  }
  return boardId;
}

export const useBoardStore = create<BoardState>()((set, get) => {
  /** Captures the opened board; `isCurrent()` turns false once another board is opened. */
  function captureBoard() {
    const boardId = requireOpenedBoardId(get().boardId);
    const generation = boardGeneration;
    return { boardId, isCurrent: () => generation === boardGeneration };
  }

  function replaceColumn(column: Column) {
    set((state) => ({
      columns: state.columns.map((existing) => (existing.id === column.id ? column : existing)),
    }));
  }

  function removeBoardFromList(boardId: string) {
    set((state) => ({ boards: state.boards.filter((board) => board.id !== boardId) }));
  }

  function forgetOpenedBoard() {
    boardGeneration += 1;
    set(openedBoardInitialState);
  }

  return {
    ...initialState,

    loadBoards: async () => {
      const generation = ++boardsGeneration;
      set({ boardsStatus: 'loading', boardsError: null });
      try {
        const boards = await boardsApi.listBoards();
        if (generation === boardsGeneration) {
          set({ boards, boardsStatus: 'ready' });
        }
      } catch (error) {
        if (generation === boardsGeneration) {
          set({ boardsStatus: 'error', boardsError: getBoardErrorMessage(error) });
        }
      }
    },

    createBoard: async (name) => {
      const generation = boardsGeneration;
      const board = await boardsApi.createBoard({ name });
      if (generation === boardsGeneration) {
        set((state) => ({ boards: [board, ...state.boards] }));
      }
      return board;
    },

    renameBoard: async (boardId, name) => {
      const listGeneration = boardsGeneration;
      const openedGeneration = boardGeneration;
      const board = await boardsApi.renameBoard(boardId, { name });
      // A list reloaded or a board reopened meanwhile (or a reset) already has newer data.
      set((state) => ({
        boards:
          listGeneration === boardsGeneration
            ? state.boards.map((existing) => (existing.id === board.id ? board : existing))
            : state.boards,
        board:
          openedGeneration === boardGeneration && state.board?.id === board.id
            ? board
            : state.board,
      }));
      return board;
    },

    deleteBoard: async (boardId) => {
      await boardsApi.deleteBoard(boardId);
      removeBoardFromList(boardId);
      if (get().boardId === boardId) {
        forgetOpenedBoard();
      }
    },

    openBoard: async (boardId) => {
      const generation = ++boardGeneration;
      set({ ...openedBoardInitialState, boardId, boardStatus: 'loading' });
      try {
        const [board, columns, members] = await Promise.all([
          boardsApi.getBoard(boardId),
          columnsApi.listColumns(boardId),
          boardsApi.listMembers(boardId),
        ]);
        if (generation === boardGeneration) {
          set({ board, columns: sortByRank(columns), members, boardStatus: 'ready' });
        }
      } catch (error) {
        if (generation !== boardGeneration) {
          return;
        }
        if (isNotFoundError(error)) {
          set({ boardStatus: 'not-found' });
        } else {
          set({ boardStatus: 'error', boardError: getBoardErrorMessage(error) });
        }
      }
    },

    reloadColumns: async () => {
      if (get().boardId === null) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      try {
        const columns = await columnsApi.listColumns(boardId);
        if (isCurrent()) {
          set({ columns: sortByRank(columns) });
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        if (isNotFoundError(error)) {
          set({ boardStatus: 'not-found' });
        } else {
          set({ notice: getBoardErrorMessage(error) });
        }
      }
    },

    createColumn: async (title) => {
      const { boardId, isCurrent } = captureBoard();
      const column = await columnsApi.createColumn(boardId, { title });
      if (!isCurrent()) {
        return column;
      }
      // New columns go to the end. The server may have rebalanced all ranks to make room and
      // returns only the new column: if it does not sort after the last local one, reload.
      const columns = [...get().columns, column];
      set({ columns });
      if (!rankFitsAt(columns, columns.length - 1)) {
        await get().reloadColumns();
      }
      return column;
    },

    renameColumn: async (columnId, title) => {
      const { boardId, isCurrent } = captureBoard();
      const previous = get().columns.find((column) => column.id === columnId);
      if (!previous) {
        return;
      }
      replaceColumn({ ...previous, title });
      try {
        const column = await columnsApi.renameColumn(boardId, columnId, { title });
        if (isCurrent()) {
          replaceColumn(column);
        }
      } catch (error) {
        if (isCurrent()) {
          const current = get().columns.find((column) => column.id === columnId);
          if (current) {
            replaceColumn({ ...current, title: previous.title });
          }
        }
        throw error;
      }
    },

    moveColumn: async (columnId, toIndex) => {
      const { boardId: openedId, columns, isMovingColumn } = get();
      if (openedId === null || isMovingColumn) {
        return;
      }
      const fromIndex = columns.findIndex((column) => column.id === columnId);
      if (fromIndex < 0 || fromIndex === toIndex || toIndex < 0 || toIndex >= columns.length) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      const originalOrder = columns;
      const reordered = reorderList(columns, fromIndex, toIndex);
      const neighbors = getMoveNeighbors(reordered, toIndex);
      set({ columns: reordered, isMovingColumn: true, notice: null });

      let needsReload: boolean;
      try {
        const moved = await columnsApi.moveColumn(boardId, columnId, neighbors);
        if (!isCurrent()) {
          return;
        }
        const updated = get().columns.map((column) => (column.id === moved.id ? moved : column));
        set({ columns: updated });
        // The response carries only the moved column. If its new rank does not fit between the
        // local neighbours, the server rebalanced the board and the other ranks are outdated.
        // Best effort: a rebalanced rank that still happens to fit between stale neighbours goes
        // unnoticed. That is harmless: the order on screen is correct and moves send only ids,
        // never ranks, so the stale ranks are replaced by the next reload.
        needsReload = !rankFitsAt(
          updated,
          updated.findIndex((column) => column.id === moved.id),
        );
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        // Undo only this move, keeping changes made to other columns while it was in flight.
        set((state) => ({
          columns: restoreOriginalPosition(state.columns, columnId, originalOrder),
          notice: getBoardErrorMessage(error),
        }));
        needsReload = isStaleColumnsError(error) || isNotFoundError(error);
      }
      try {
        if (needsReload) {
          await get().reloadColumns();
        }
      } finally {
        if (isCurrent()) {
          set({ isMovingColumn: false });
        }
      }
    },

    updateColumnSettings: async (columnId, input) => {
      const { boardId, isCurrent } = captureBoard();
      const column = await columnsApi.updateColumnSettings(boardId, columnId, input);
      if (isCurrent()) {
        replaceColumn(column);
      }
      return column;
    },

    deleteColumn: async (columnId) => {
      const { boardId, isCurrent } = captureBoard();
      await columnsApi.deleteColumn(boardId, columnId);
      if (isCurrent()) {
        set((state) => ({ columns: state.columns.filter((column) => column.id !== columnId) }));
      }
    },

    addMember: async (input) => {
      const { boardId, isCurrent } = captureBoard();
      const member = await boardsApi.addMember(boardId, input);
      if (isCurrent()) {
        set((state) => ({ members: sortMembers([...state.members, member]) }));
      }
      return member;
    },

    updateMemberRole: async (userId, role) => {
      const { boardId, isCurrent } = captureBoard();
      const member = await boardsApi.updateMemberRole(boardId, userId, role);
      if (isCurrent()) {
        const isSelf = useAuthStore.getState().user?.id === member.userId;
        set((state) => ({
          members: sortMembers(
            state.members.map((existing) => (existing.userId === userId ? member : existing)),
          ),
          board: isSelf && state.board ? { ...state.board, role: member.role } : state.board,
        }));
      }
      return member;
    },

    removeMember: async (userId) => {
      const { boardId, isCurrent } = captureBoard();
      await boardsApi.removeMember(boardId, userId);
      if (isCurrent()) {
        set((state) => ({ members: state.members.filter((member) => member.userId !== userId) }));
      }
    },

    leaveBoard: async () => {
      const { boardId, isCurrent } = captureBoard();
      const userId = useAuthStore.getState().user?.id;
      if (userId === undefined) {
        throw new Error('Not logged in');
      }
      await boardsApi.removeMember(boardId, userId);
      removeBoardFromList(boardId);
      if (isCurrent()) {
        forgetOpenedBoard();
      }
    },

    dismissNotice: () => set({ notice: null }),
  };
});

/** Clears all board data and drops the results of requests in flight. */
export function resetBoardStore(): void {
  boardGeneration += 1;
  boardsGeneration += 1;
  useBoardStore.setState(initialState);
}

// Board data belongs to the session it was loaded in: forget it on logout or user change.
useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch !== previous.sessionEpoch || state.user?.id !== previous.user?.id) {
    resetBoardStore();
  }
});
