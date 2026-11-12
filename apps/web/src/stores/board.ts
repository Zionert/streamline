import {
  BOARD_ROLES,
  type AddBoardMemberInput,
  type AssignableBoardRole,
  type Board,
  type BoardMember,
  type Card,
  type Column,
  type UpdateCardInput,
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
import {
  getCardErrorMessage,
  isColumnGoneError,
  needsCardsReload,
} from '@/features/cards/cardErrorMessage';
import {
  cardsOf,
  findCard,
  groupCards,
  insertCardByRank,
  moveCardLocally,
  removeCard,
  replaceCard,
  restoreCardPosition,
  unassignCards,
  type CardsByColumn,
} from '@/features/cards/cardOrder';
import * as cardsApi from '@/features/cards/cardsApi';
import { useAuthStore } from '@/stores/auth';

export type BoardsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CurrentBoardStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

export type CardsStatus = 'idle' | 'loading' | 'ready' | 'error';

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
  /** Cards of the opened board by column id, in display order (by rank, except during a move). */
  cardsByColumn: CardsByColumn;
  cardsStatus: CardsStatus;
  /** A card move (and the reload that may follow) is in progress; further drags wait for it. */
  isMovingCard: boolean;
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

  /** Reloads the cards of the opened board; never rejects (a failure sets `notice`). */
  reloadCards: () => Promise<void>;
  /** Creates a card at the end of the column (reloads the cards if the server rebalanced). */
  createCard: (columnId: string, title: string) => Promise<Card>;
  /**
   * Moves a card to `toIndex` of `toColumnId` optimistically; never rejects. On failure only this
   * card goes back and `notice` is set; a stale view or a server-side rebalance triggers a reload.
   */
  moveCard: (cardId: string, toColumnId: string, toIndex: number) => Promise<void>;
  /** Applies the (validated) changes optimistically; restores them and rethrows on failure. */
  updateCard: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  deleteCard: (cardId: string) => Promise<void>;
  /** Shows a card loaded on its own (e.g. opened by its address) if it is not shown yet. */
  rememberCard: (card: Card) => void;

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
  | 'cardsByColumn'
  | 'cardsStatus'
  | 'isMovingCard'
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
  cardsByColumn: {},
  cardsStatus: 'idle',
  isMovingCard: false,
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
/**
 * Incremented by every card list request and by every card move: only the latest list request
 * may apply its result, and a list read before a move must not undo the move on screen.
 */
let cardsGeneration = 0;
/** Generation of the latest card list request that has not settled yet, or `null`. */
let pendingCardsLoad: number | null = null;

const CARD_EDIT_FIELDS = ['title', 'description', 'priority', 'assigneeId', 'dueDate'] as const;
type CardEditField = (typeof CARD_EDIT_FIELDS)[number];

/**
 * Card edits are numbered; for every card field (`<cardId>:<field>`) the number of the latest
 * edit is kept. Responses of edits may arrive out of order: a response or a rollback only touches
 * the fields whose latest edit it belongs to.
 */
let cardEditSequence = 0;
const latestCardEdits = new Map<string, number>();
const cardEditsInFlight = new Set<number>();

const cardEditKey = (cardId: string, field: CardEditField) => `${cardId}:${field}`;

function editedFields(input: UpdateCardInput): CardEditField[] {
  return CARD_EDIT_FIELDS.filter((field) => input[field] !== undefined);
}

function pickFields(input: UpdateCardInput, fields: readonly CardEditField[]): UpdateCardInput {
  return Object.fromEntries(fields.map((field) => [field, input[field]]));
}

/**
 * The server's version of a card after edit `sequence`, except for fields with a newer edit (or
 * an edit still in flight), which keep their local value. The column and rank always stay local:
 * an edit never changes them, but a move may be in flight.
 */
function mergeEditResponse(current: Card, server: Card, sequence: number): Card {
  let merged: Card = {
    ...server,
    columnId: current.columnId,
    rank: current.rank,
    // ISO timestamps of the same format compare correctly as strings.
    updatedAt: current.updatedAt > server.updatedAt ? current.updatedAt : server.updatedAt,
  };
  for (const field of CARD_EDIT_FIELDS) {
    const latest = latestCardEdits.get(cardEditKey(current.id, field));
    if (
      latest !== undefined &&
      latest !== sequence &&
      (latest > sequence || cardEditsInFlight.has(latest))
    ) {
      merged = { ...merged, [field]: current[field] };
    }
  }
  return merged;
}

/** Members ordered like the API returns them: by role, then (stable) by joining order. */
function sortMembers(members: readonly BoardMember[]): BoardMember[] {
  return [...members].sort((a, b) => BOARD_ROLES.indexOf(a.role) - BOARD_ROLES.indexOf(b.role));
}

/** The card with the fields present in `input` changed (absent fields stay as they are). */
function applyFields(card: Card, input: UpdateCardInput): Card {
  return {
    ...card,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
  };
}

/** `current` with the fields present in `input` set back to their values in `previous`. */
function restoreFields(current: Card, previous: Card, input: UpdateCardInput): Card {
  return applyFields(current, {
    ...(input.title === undefined ? {} : { title: previous.title }),
    ...(input.description === undefined ? {} : { description: previous.description }),
    ...(input.priority === undefined ? {} : { priority: previous.priority }),
    ...(input.assigneeId === undefined ? {} : { assigneeId: previous.assigneeId }),
    ...(input.dueDate === undefined ? {} : { dueDate: previous.dueDate }),
  });
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

  function setCards(update: (cardsByColumn: CardsByColumn) => CardsByColumn) {
    set((state) => ({ cardsByColumn: update(state.cardsByColumn) }));
  }

  /** Loads the cards of the opened board unless another board is opened meanwhile. */
  async function loadCards(boardId: string, isCurrent: () => boolean) {
    const generation = ++cardsGeneration;
    const isLatest = () => isCurrent() && generation === cardsGeneration;
    pendingCardsLoad = generation;
    if (get().cardsStatus !== 'ready') {
      set({ cardsStatus: 'loading' });
    }
    try {
      const columns = await cardsApi.listCards(boardId);
      if (isLatest()) {
        set({ cardsByColumn: groupCards(columns), cardsStatus: 'ready' });
      }
    } catch (error) {
      if (!isLatest()) {
        return;
      }
      if (isNotFoundError(error)) {
        set({ boardStatus: 'not-found' });
      } else {
        // Cards already shown stay and the failure is a notice; a failed first load is shown
        // by the page itself (with a retry), so it needs no notice.
        set((state) =>
          state.cardsStatus === 'ready'
            ? { notice: getBoardErrorMessage(error) }
            : { cardsStatus: 'error' },
        );
      }
    } finally {
      if (pendingCardsLoad === generation) {
        pendingCardsLoad = null;
      }
    }
  }

  /**
   * A list request that was already in flight when a card change completed may have been read
   * before the change: its result would undo the change on screen, so the list is read again.
   */
  async function reloadIfListInFlight() {
    if (pendingCardsLoad !== null) {
      await get().reloadCards();
    }
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
      const isCurrent = () => generation === boardGeneration;
      set({ ...openedBoardInitialState, boardId, boardStatus: 'loading' });
      // Cards load alongside; the columns are shown first, with card skeletons until they arrive.
      const cardsLoading = loadCards(boardId, isCurrent);
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
      await cardsLoading;
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
        set((state) => ({
          columns: state.columns.filter((column) => column.id !== columnId),
          cardsByColumn: Object.fromEntries(
            Object.entries(state.cardsByColumn).filter(([id]) => id !== columnId),
          ),
        }));
      }
    },

    reloadCards: async () => {
      if (get().boardId === null) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      await loadCards(boardId, isCurrent);
    },

    createCard: async (columnId, title) => {
      const { boardId, isCurrent } = captureBoard();
      let card: Card;
      try {
        card = await cardsApi.createCard(boardId, { columnId, title });
      } catch (error) {
        if (isCurrent() && isColumnGoneError(error)) {
          // The column was deleted elsewhere. The composer disappears with it once the board is
          // refreshed, so the message is also shown as a notice.
          set({ notice: getCardErrorMessage(error) });
          await Promise.all([get().reloadColumns(), get().reloadCards()]);
        }
        throw error;
      }
      if (!isCurrent()) {
        return card;
      }
      // New cards go to the end of the column. The server may have rebalanced the column to make
      // room and returns only the new card: if it does not sort after the last local one, reload.
      const cards = [...cardsOf(get().cardsByColumn, columnId), card];
      setCards((cardsByColumn) => ({ ...cardsByColumn, [columnId]: cards }));
      if (!rankFitsAt(cards, cards.length - 1)) {
        await get().reloadCards();
      } else {
        await reloadIfListInFlight();
      }
      return card;
    },

    moveCard: async (cardId, toColumnId, toIndex) => {
      const { boardId: openedId, cardsByColumn, isMovingCard } = get();
      if (openedId === null || isMovingCard) {
        return;
      }
      const location = findCard(cardsByColumn, cardId);
      if (!location) {
        return;
      }
      const sameColumn = location.columnId === toColumnId;
      const targetLength = cardsOf(cardsByColumn, toColumnId).length;
      const maxIndex = sameColumn ? targetLength - 1 : targetLength;
      if ((sameColumn && location.index === toIndex) || toIndex < 0 || toIndex > maxIndex) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      const original = location.card;
      const originalList = cardsOf(cardsByColumn, location.columnId);
      const moved = moveCardLocally(cardsByColumn, cardId, toColumnId, toIndex);
      const neighbors = getMoveNeighbors(cardsOf(moved, toColumnId), toIndex);
      // A list requested before this move would show the old position: drop its result (and
      // read the list again once the move is done).
      const listWasInFlight = pendingCardsLoad !== null;
      cardsGeneration += 1;
      set({ cardsByColumn: moved, isMovingCard: true, notice: null });

      let needsReload: boolean;
      let columnGone = false;
      try {
        const card = await cardsApi.moveCard(boardId, cardId, {
          columnId: toColumnId,
          ...neighbors,
        });
        if (!isCurrent()) {
          return;
        }
        const current = findCard(get().cardsByColumn, cardId);
        if (current && current.columnId === card.columnId) {
          const updated = replaceCard(get().cardsByColumn, card);
          set({ cardsByColumn: updated });
          // The response carries only the moved card. If its new rank does not fit between the
          // local neighbours, the server rebalanced the column and the other ranks are outdated
          // (best effort, as for columns: moves send only ids, so stale ranks are harmless).
          needsReload = !rankFitsAt(cardsOf(updated, card.columnId), current.index);
        } else {
          needsReload = true;
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        // Undo only this move, keeping changes made to other cards while it was in flight.
        set((state) => ({
          cardsByColumn: restoreCardPosition(state.cardsByColumn, original, originalList),
          notice: getCardErrorMessage(error),
        }));
        needsReload = needsCardsReload(error);
        columnGone = isColumnGoneError(error);
      }
      try {
        if (needsReload || listWasInFlight) {
          // A column deleted elsewhere must disappear from the board as well.
          await Promise.all([get().reloadCards(), columnGone ? get().reloadColumns() : undefined]);
        }
      } finally {
        if (isCurrent()) {
          set({ isMovingCard: false });
        }
      }
    },

    updateCard: async (cardId, input) => {
      const { boardId, isCurrent } = captureBoard();
      const fields = editedFields(input);
      const sequence = ++cardEditSequence;
      for (const field of fields) {
        latestCardEdits.set(cardEditKey(cardId, field), sequence);
      }
      cardEditsInFlight.add(sequence);
      const isLatestEdit = (field: CardEditField) =>
        latestCardEdits.get(cardEditKey(cardId, field)) === sequence;
      const previous = findCard(get().cardsByColumn, cardId)?.card;
      if (previous) {
        setCards((cards) => replaceCard(cards, applyFields(previous, input)));
      }
      try {
        const card = await cardsApi.updateCard(boardId, cardId, input);
        if (isCurrent()) {
          setCards((cards) => {
            const current = findCard(cards, cardId)?.card;
            return current ? replaceCard(cards, mergeEditResponse(current, card, sequence)) : cards;
          });
          void reloadIfListInFlight();
        }
        return card;
      } catch (error) {
        if (isCurrent()) {
          if (isNotFoundError(error)) {
            // The card was deleted elsewhere.
            setCards((cards) => removeCard(cards, cardId));
          } else {
            // Restore only the fields whose latest edit this was: an older failure must not
            // undo a newer edit, and other changes made meanwhile stay.
            const current = findCard(get().cardsByColumn, cardId)?.card;
            const restorable = pickFields(input, fields.filter(isLatestEdit));
            if (previous && current) {
              setCards((cards) => replaceCard(cards, restoreFields(current, previous, restorable)));
            }
          }
        }
        throw error;
      } finally {
        cardEditsInFlight.delete(sequence);
      }
    },

    deleteCard: async (cardId) => {
      const { boardId, isCurrent } = captureBoard();
      await cardsApi.deleteCard(boardId, cardId);
      if (isCurrent()) {
        setCards((cards) => removeCard(cards, cardId));
        await reloadIfListInFlight();
      }
    },

    rememberCard: (card) => {
      if (get().boardId === card.boardId) {
        setCards((cards) => insertCardByRank(cards, card));
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
        // The server unassigns the removed member from the cards of the board as well.
        set((state) => ({
          members: state.members.filter((member) => member.userId !== userId),
          cardsByColumn: unassignCards(state.cardsByColumn, userId),
        }));
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
  cardsGeneration += 1;
  pendingCardsLoad = null;
  latestCardEdits.clear();
  cardEditsInFlight.clear();
  useBoardStore.setState(initialState);
}

// Board data belongs to the session it was loaded in: forget it on logout or user change.
useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch !== previous.sessionEpoch || state.user?.id !== previous.user?.id) {
    resetBoardStore();
  }
});
