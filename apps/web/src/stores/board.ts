import {
  BOARD_ROLES,
  CARD_ERROR_CODES,
  LABEL_ERROR_CODES,
  type AddBoardMemberInput,
  type AssignableBoardRole,
  type Board,
  type BoardEvent,
  type BoardMember,
  type Card,
  type Column,
  type CreateLabelInput,
  type Label,
  type UpdateCardInput,
  type UpdateColumnSettingsInput,
  type UpdateLabelInput,
} from '@streamline/shared';
import { create } from 'zustand';

import {
  getBoardErrorMessage,
  isAccessLostError,
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
  wipLimitMessage,
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
import { removeLabelFromCards, toggleLabelId, upsertLabel } from '@/features/labels/labelOrder';
import * as labelsApi from '@/features/labels/labelsApi';
import {
  applyCardRanks,
  applyRanks,
  placeCard,
  removeColumn,
  updateCardFields,
  updateColumnFields,
  upsertColumnByRank,
  upsertMember,
  withBoardKey,
} from '@/features/realtime/boardEventReducers';
import { getApiErrorInfo } from '@/lib/api-error';
import { receiveActivity } from '@/stores/activity';
import { useAuthStore } from '@/stores/auth';
import { reloadFeeds, resetFeedsExcept } from '@/stores/cardFeeds';
import { applyCommentEvent } from '@/stores/comments';

export type BoardsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CurrentBoardStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

export type CardsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type LabelsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Outcome of `resyncBoard`: `access-lost` when the board is gone or the user is no member. */
export type ResyncResult = 'ok' | 'access-lost' | 'error';

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
  /** Ids of cards of the opened board deleted by someone else (e.g. to explain a closed modal). */
  deletedCardIds: ReadonlySet<string>;
  /** Labels of the opened board in creation order (the order of `labelIds` on cards). */
  labels: Label[];
  labelsStatus: LabelsStatus;

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

  /** Reloads the labels of the opened board; never rejects (the labels keep their last state). */
  reloadLabels: () => Promise<void>;
  createLabel: (input: CreateLabelInput) => Promise<Label>;
  updateLabel: (labelId: string, input: UpdateLabelInput) => Promise<Label>;
  /** Deletes the label and removes it from every card of the board. */
  deleteLabel: (labelId: string) => Promise<void>;
  /**
   * Attaches the label to the card (`attach`) or removes it, optimistically; on failure only this
   * label goes back to its previous state on the card and the error is rethrown.
   */
  toggleCardLabel: (cardId: string, labelId: string, attach: boolean) => Promise<void>;

  addMember: (input: AddBoardMemberInput) => Promise<BoardMember>;
  updateMemberRole: (userId: string, role: AssignableBoardRole) => Promise<BoardMember>;
  removeMember: (userId: string) => Promise<void>;
  /** Removes the current user from the opened board and forgets the board locally. */
  leaveBoard: () => Promise<void>;
  dismissNotice: () => void;

  /**
   * Applies a change made by someone else, broadcast by the server. Idempotent; events of
   * another board are ignored. During a local move, events that reorder the moved list are
   * skipped and the list is reloaded once the move has settled.
   */
  applyBoardEvent: (event: BoardEvent) => void;
  /**
   * Reloads the board, columns, members and cards of the opened board `boardId` (e.g. after
   * joining its socket room); never rejects. A snapshot never overwrites a newer one, and a list
   * with a move in flight is reloaded once the move has settled instead.
   */
  resyncBoard: (boardId: string) => Promise<ResyncResult>;
  /** Forgets a board the user lost access to (removed, or the board was deleted). */
  forgetBoard: (boardId: string) => void;
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
  | 'deletedCardIds'
  | 'labels'
  | 'labelsStatus'
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
  deletedCardIds: new Set<string>(),
  labels: [],
  labelsStatus: 'idle',
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
/** The same guards for the column list: only the latest read may apply its result. */
let columnsGeneration = 0;
let pendingColumnsLoad: number | null = null;
/**
 * Incremented by every read of the board and its members (opening, resync): a snapshot started
 * earlier never overwrites the result of a later one.
 */
let snapshotGeneration = 0;
/** The same guards for the label list: only the latest read may apply its result. */
let labelsGeneration = 0;
let pendingLabelsLoad: number | null = null;

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

/**
 * Label toggles: per card, the number of toggles still in flight and the newest label ids known
 * to be on the server (with the card's `updatedAt` of that version). While a toggle is in flight
 * the local `labelIds` are the newest; once the last one settles the card shows the newest
 * confirmed ids, so responses arriving out of order or several failures cannot leave the card
 * showing ids the server never had.
 */
const labelTogglesInFlight = new Map<string, number>();
interface ConfirmedLabels {
  labelIds: string[];
  updatedAt: string;
}
const confirmedLabels = new Map<string, ConfirmedLabels>();
/** Incremented whenever the tracking is cleared: toggles started before do not touch it. */
let editTrackingGeneration = 0;

/** Records the label ids of a server version of the card, unless a newer one is known. */
function noteConfirmedLabels(card: Pick<Card, 'id' | 'labelIds' | 'updatedAt'>) {
  const known = confirmedLabels.get(card.id);
  // ISO timestamps of the same format compare correctly as strings.
  if (!known || card.updatedAt >= known.updatedAt) {
    confirmedLabels.set(card.id, { labelIds: [...card.labelIds], updatedAt: card.updatedAt });
  }
}

function hasLabelToggleInFlight(cardId: string): boolean {
  return (labelTogglesInFlight.get(cardId) ?? 0) > 0;
}

/** Fields of the card with a local change still in flight (their local value is the newest). */
function fieldsEditedInFlight(cardId: string): (CardEditField | 'labelIds')[] {
  const fields: (CardEditField | 'labelIds')[] = CARD_EDIT_FIELDS.filter((field) => {
    const latest = latestCardEdits.get(cardEditKey(cardId, field));
    return latest !== undefined && cardEditsInFlight.has(latest);
  });
  return hasLabelToggleInFlight(cardId) ? [...fields, 'labelIds'] : fields;
}

/** Forgets the bookkeeping of local card changes (another board, or a reset). */
function clearCardEditTracking() {
  latestCardEdits.clear();
  cardEditsInFlight.clear();
  labelTogglesInFlight.clear();
  confirmedLabels.clear();
  editTrackingGeneration += 1;
}

/**
 * The move request of a column / card is in flight (a token of the move, or `null`). Remote
 * events that reorder that list are not applied meanwhile (the moved item's rank is still the old
 * one, so sorting would undo the move on screen); the `...ChangedDuringMove` flag records them and
 * the list is reloaded as soon as the request has settled. Events arriving during that reload are
 * applied normally (and make the reload read the list again).
 */
let columnMoveInFlight: number | null = null;
let cardMoveInFlight: number | null = null;
let moveToken = 0;
let columnsChangedDuringMove = false;
let cardsChangedDuringMove = false;

function takeFlag(flag: 'columns' | 'cards'): boolean {
  const value = flag === 'columns' ? columnsChangedDuringMove : cardsChangedDuringMove;
  if (flag === 'columns') {
    columnsChangedDuringMove = false;
  } else {
    cardsChangedDuringMove = false;
  }
  return value;
}

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
    // Label toggles in flight are newer than this response.
    labelIds: hasLabelToggleInFlight(current.id) ? current.labelIds : server.labelIds,
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

  /** Starts a read of the column list; only the latest read may apply its result. */
  function beginColumnsRead() {
    const generation = ++columnsGeneration;
    pendingColumnsLoad = generation;
    return {
      isLatest: () => generation === columnsGeneration,
      settle: () => {
        if (pendingColumnsLoad === generation) {
          pendingColumnsLoad = null;
        }
      },
    };
  }

  /** A remote column change may be missing from a column list being read: read it again. */
  function rereadColumnsIfLoading() {
    if (pendingColumnsLoad !== null) {
      void get().reloadColumns();
    }
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
    columnsChangedDuringMove = false;
    cardsChangedDuringMove = false;
    clearCardEditTracking();
    resetFeedsExcept(null);
    set(openedBoardInitialState);
  }

  /** Loads the labels of the opened board; a failure keeps the labels shown (or none). */
  async function loadLabels(boardId: string, isCurrent: () => boolean) {
    const generation = ++labelsGeneration;
    const isLatest = () => isCurrent() && generation === labelsGeneration;
    pendingLabelsLoad = generation;
    if (get().labelsStatus !== 'ready') {
      set({ labelsStatus: 'loading' });
    }
    try {
      const labels = await labelsApi.listLabels(boardId);
      if (isLatest()) {
        set({ labels, labelsStatus: 'ready' });
      }
    } catch {
      // Labels are secondary: the board stays usable, and a missing board is reported by the
      // requests of the board itself.
      if (isLatest()) {
        set((state) => (state.labelsStatus === 'ready' ? {} : { labelsStatus: 'error' }));
      }
    } finally {
      if (pendingLabelsLoad === generation) {
        pendingLabelsLoad = null;
      }
    }
  }

  /** A remote label change may be missing from a label list being read: read it again. */
  function rereadLabelsIfLoading() {
    if (pendingLabelsLoad !== null) {
      void get().reloadLabels();
    }
  }

  /** Removes a label deleted (here or elsewhere) from the board and from every card. */
  function dropLabel(labelId: string) {
    for (const [cardId, known] of confirmedLabels) {
      confirmedLabels.set(cardId, {
        ...known,
        labelIds: known.labelIds.filter((id) => id !== labelId),
      });
    }
    set((state) => ({
      labels: state.labels.filter((label) => label.id !== labelId),
      cardsByColumn: removeLabelFromCards(state.cardsByColumn, labelId),
    }));
  }

  /** A remote card change may be missing from a card list that is being read: read it again. */
  function rereadCardsIfLoading() {
    if (pendingCardsLoad !== null) {
      void get().reloadCards();
    }
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
      columnsChangedDuringMove = false;
      cardsChangedDuringMove = false;
      if (get().boardId !== boardId) {
        clearCardEditTracking();
      }
      resetFeedsExcept(boardId);
      set({ ...openedBoardInitialState, boardId, boardStatus: 'loading' });
      // Cards and labels load alongside; the columns are shown first, with card skeletons until
      // the cards arrive.
      const cardsLoading = loadCards(boardId, isCurrent);
      const labelsLoading = loadLabels(boardId, isCurrent);
      const snapshot = ++snapshotGeneration;
      // A resync started meanwhile (e.g. after joining the socket room) has newer data.
      const isLatestSnapshot = () => isCurrent() && snapshot === snapshotGeneration;
      const columnsRead = beginColumnsRead();
      try {
        const [board, columns, members] = await Promise.all([
          boardsApi.getBoard(boardId),
          columnsApi.listColumns(boardId),
          boardsApi.listMembers(boardId),
        ]);
        if (isLatestSnapshot()) {
          set({
            board,
            members,
            boardStatus: 'ready',
            ...(columnsRead.isLatest() ? { columns: sortByRank(columns) } : {}),
          });
        }
      } catch (error) {
        if (!isLatestSnapshot()) {
          return;
        }
        if (isNotFoundError(error)) {
          set({ boardStatus: 'not-found' });
        } else {
          set({ boardStatus: 'error', boardError: getBoardErrorMessage(error) });
        }
      } finally {
        columnsRead.settle();
      }
      await Promise.all([cardsLoading, labelsLoading]);
    },

    reloadColumns: async () => {
      if (get().boardId === null) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      const read = beginColumnsRead();
      try {
        const columns = await columnsApi.listColumns(boardId);
        if (isCurrent() && read.isLatest()) {
          set({ columns: sortByRank(columns) });
        }
      } catch (error) {
        if (!isCurrent() || !read.isLatest()) {
          return;
        }
        if (isNotFoundError(error)) {
          set({ boardStatus: 'not-found' });
        } else {
          set({ notice: getBoardErrorMessage(error) });
        }
      } finally {
        read.settle();
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
      columnsChangedDuringMove = false;
      const token = ++moveToken;
      columnMoveInFlight = token;
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
      } finally {
        if (columnMoveInFlight === token) {
          columnMoveInFlight = null;
        }
      }
      try {
        // `takeFlag` runs even when a reload is needed anyway, to reset the flag.
        if (takeFlag('columns') || needsReload) {
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
      // A full column with a strict WIP limit refuses cards from other columns. The server would
      // answer 409, so the move is not even attempted.
      const target = get().columns.find((column) => column.id === toColumnId);
      if (
        !sameColumn &&
        target?.wipStrict === true &&
        target.wipLimit !== null &&
        targetLength >= target.wipLimit
      ) {
        set({ notice: wipLimitMessage(target.title, target.wipLimit) });
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
      cardsChangedDuringMove = false;
      const token = ++moveToken;
      cardMoveInFlight = token;
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
        // A strict WIP refusal means the local card count of the column was stale.
        needsReload =
          needsCardsReload(error) ||
          getApiErrorInfo(error).code === CARD_ERROR_CODES.WIP_LIMIT_EXCEEDED;
        columnGone = isColumnGoneError(error);
      } finally {
        if (cardMoveInFlight === token) {
          cardMoveInFlight = null;
        }
      }
      try {
        if (takeFlag('cards') || needsReload || listWasInFlight) {
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
          if (hasLabelToggleInFlight(cardId)) {
            noteConfirmedLabels(card);
          }
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

    reloadLabels: async () => {
      if (get().boardId === null) {
        return;
      }
      const { boardId, isCurrent } = captureBoard();
      await loadLabels(boardId, isCurrent);
    },

    createLabel: async (input) => {
      const { boardId, isCurrent } = captureBoard();
      const label = await labelsApi.createLabel(boardId, input);
      if (isCurrent()) {
        set((state) => ({ labels: upsertLabel(state.labels, label) }));
      }
      return label;
    },

    updateLabel: async (labelId, input) => {
      const { boardId, isCurrent } = captureBoard();
      try {
        const label = await labelsApi.updateLabel(boardId, labelId, input);
        if (isCurrent()) {
          set((state) => ({ labels: upsertLabel(state.labels, label) }));
        }
        return label;
      } catch (error) {
        if (isCurrent() && isNotFoundError(error)) {
          dropLabel(labelId);
        }
        throw error;
      }
    },

    deleteLabel: async (labelId) => {
      const { boardId, isCurrent } = captureBoard();
      try {
        await labelsApi.deleteLabel(boardId, labelId);
      } catch (error) {
        // A label deleted elsewhere is gone either way.
        if (!isNotFoundError(error)) {
          throw error;
        }
      }
      if (isCurrent()) {
        dropLabel(labelId);
      }
    },

    toggleCardLabel: async (cardId, labelId, attach) => {
      const { boardId, isCurrent } = captureBoard();
      const shown = findCard(get().cardsByColumn, cardId)?.card;
      if (!shown || shown.labelIds.includes(labelId) === attach) {
        return;
      }
      const tracking = editTrackingGeneration;
      if (!hasLabelToggleInFlight(cardId)) {
        // Nothing in flight: the shown ids are the newest confirmed ones.
        confirmedLabels.set(cardId, { labelIds: [...shown.labelIds], updatedAt: shown.updatedAt });
      }
      labelTogglesInFlight.set(cardId, (labelTogglesInFlight.get(cardId) ?? 0) + 1);
      setCards((cards) =>
        replaceCard(cards, {
          ...shown,
          labelIds: toggleLabelId(shown.labelIds, labelId, attach, get().labels),
        }),
      );
      /** Counts this toggle as settled; `true` when it was the last one in flight for the card. */
      const settle = (): boolean => {
        if (tracking !== editTrackingGeneration) {
          // The tracking was cleared (another board was opened meanwhile).
          return false;
        }
        const remaining = (labelTogglesInFlight.get(cardId) ?? 1) - 1;
        if (remaining > 0) {
          labelTogglesInFlight.set(cardId, remaining);
          return false;
        }
        labelTogglesInFlight.delete(cardId);
        return true;
      };
      /** Shows the newest confirmed ids on the card (after its last toggle settled). */
      const showConfirmed = () => {
        const known = confirmedLabels.get(cardId);
        if (!known) {
          return;
        }
        setCards((cards) => {
          const current = findCard(cards, cardId)?.card;
          return current
            ? replaceCard(cards, {
                ...current,
                labelIds: known.labelIds,
                updatedAt:
                  current.updatedAt > known.updatedAt ? current.updatedAt : known.updatedAt,
              })
            : cards;
        });
      };
      let card: Card;
      try {
        card = attach
          ? await labelsApi.attachLabel(boardId, cardId, labelId)
          : await labelsApi.detachLabel(boardId, cardId, labelId);
      } catch (error) {
        const wasLast = settle();
        if (isCurrent()) {
          const { status, code } = getApiErrorInfo(error);
          if (code === LABEL_ERROR_CODES.LABEL_NOT_FOUND) {
            // The label was deleted elsewhere.
            dropLabel(labelId);
          } else if (status === 404) {
            // The card was deleted elsewhere.
            setCards((cards) => removeCard(cards, cardId));
          } else if (wasLast) {
            showConfirmed();
          } else {
            // Other toggles are in flight: undo only this label until they settle.
            setCards((cards) => {
              const current = findCard(cards, cardId)?.card;
              return current
                ? replaceCard(cards, {
                    ...current,
                    labelIds: toggleLabelId(current.labelIds, labelId, !attach, get().labels),
                  })
                : cards;
            });
          }
        }
        throw error;
      }
      const wasLast = settle();
      if (!isCurrent()) {
        return;
      }
      noteConfirmedLabels(card);
      if (wasLast) {
        showConfirmed();
      }
      void reloadIfListInFlight();
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

    applyBoardEvent: (event) => {
      const state = get();
      if (state.boardId === null || state.boardId !== event.payload.boardId) {
        return;
      }
      switch (event.name) {
        case 'board:updated': {
          const summary = event.payload.board;
          set((current) => ({
            // The role is per user and is not part of the event.
            board: current.board ? { ...current.board, ...summary } : current.board,
            boards: current.boards.map((board) =>
              board.id === summary.id ? { ...board, ...summary } : board,
            ),
            cardsByColumn:
              current.board && current.board.key !== summary.key
                ? withBoardKey(current.cardsByColumn, summary.key)
                : current.cardsByColumn,
          }));
          return;
        }
        case 'board:deleted':
          // Handled by the realtime hook, which leaves the page.
          return;
        case 'column:created':
        case 'column:moved':
          if (columnMoveInFlight !== null) {
            columnsChangedDuringMove = true;
            return;
          }
          set((current) => ({
            columns: upsertColumnByRank(current.columns, event.payload.column),
          }));
          rereadColumnsIfLoading();
          return;
        case 'column:updated':
          set((current) => ({
            columns: updateColumnFields(current.columns, event.payload.column),
          }));
          rereadColumnsIfLoading();
          return;
        case 'column:deleted':
          // Removing an item is safe during a move (its rollback copes with missing neighbours).
          if (columnMoveInFlight !== null) {
            columnsChangedDuringMove = true;
          }
          set((current) =>
            removeColumn(current.columns, current.cardsByColumn, event.payload.columnId),
          );
          rereadColumnsIfLoading();
          return;
        case 'columns:rebalanced':
          if (columnMoveInFlight !== null) {
            columnsChangedDuringMove = true;
            return;
          }
          set((current) => ({ columns: applyRanks(current.columns, event.payload.ranks) }));
          rereadColumnsIfLoading();
          return;
        case 'card:created':
        case 'card:moved': {
          if (cardMoveInFlight !== null) {
            cardsChangedDuringMove = true;
            return;
          }
          const { card } = event.payload;
          if (hasLabelToggleInFlight(card.id)) {
            noteConfirmedLabels(card);
          }
          const shown = findCard(state.cardsByColumn, card.id)?.card;
          // Fields with a local edit in flight keep their local (newer) value.
          const merged = shown
            ? fieldsEditedInFlight(card.id).reduce<Card>(
                (result, field) => ({ ...result, [field]: shown[field] }),
                card,
              )
            : card;
          setCards((cards) => placeCard(cards, merged));
          rereadCardsIfLoading();
          return;
        }
        case 'card:updated': {
          const { card } = event.payload;
          if (hasLabelToggleInFlight(card.id)) {
            noteConfirmedLabels(card);
          }
          setCards((cards) => updateCardFields(cards, card, fieldsEditedInFlight(card.id)));
          rereadCardsIfLoading();
          return;
        }
        case 'card:deleted': {
          const { cardId } = event.payload;
          if (cardMoveInFlight !== null) {
            cardsChangedDuringMove = true;
          }
          set((current) => ({
            deletedCardIds: new Set(current.deletedCardIds).add(cardId),
            cardsByColumn: removeCard(current.cardsByColumn, cardId),
          }));
          rereadCardsIfLoading();
          return;
        }
        case 'cards:rebalanced':
          if (cardMoveInFlight !== null) {
            cardsChangedDuringMove = true;
            return;
          }
          setCards((cards) => applyCardRanks(cards, event.payload.columnId, event.payload.ranks));
          rereadCardsIfLoading();
          return;
        case 'label:created':
        case 'label:updated':
          set((current) => ({ labels: upsertLabel(current.labels, event.payload.label) }));
          rereadLabelsIfLoading();
          return;
        case 'label:deleted':
          dropLabel(event.payload.labelId);
          rereadLabelsIfLoading();
          // A card list being read may still carry the label.
          rereadCardsIfLoading();
          return;
        case 'comment:created':
        case 'comment:updated':
        case 'comment:deleted':
          applyCommentEvent(event);
          return;
        case 'activity:created':
          receiveActivity(event.payload.activity);
          return;
        case 'member:added':
          set((current) => ({
            members: sortMembers(upsertMember(current.members, event.payload.member)),
          }));
          return;
        case 'member:updated': {
          const { member } = event.payload;
          const isSelf = useAuthStore.getState().user?.id === member.userId;
          set((current) => ({
            members: current.members.some((entry) => entry.userId === member.userId)
              ? sortMembers(upsertMember(current.members, member))
              : current.members,
            board:
              isSelf && current.board ? { ...current.board, role: member.role } : current.board,
            boards: isSelf
              ? current.boards.map((board) =>
                  board.id === event.payload.boardId ? { ...board, role: member.role } : board,
                )
              : current.boards,
          }));
          return;
        }
        case 'member:removed':
          // The server unassigns the removed member from the cards of the board as well.
          set((current) => ({
            members: current.members.filter((member) => member.userId !== event.payload.userId),
            cardsByColumn: unassignCards(current.cardsByColumn, event.payload.userId),
          }));
          return;
      }
    },

    resyncBoard: async (openedId) => {
      if (get().boardId !== openedId) {
        return 'ok';
      }
      const { boardId, isCurrent } = captureBoard();
      const snapshot = ++snapshotGeneration;
      const isLatestSnapshot = () => isCurrent() && snapshot === snapshotGeneration;
      // A list with a move request in flight is reloaded right after the request instead.
      const deferColumns = columnMoveInFlight !== null;
      const deferCards = cardMoveInFlight !== null;
      columnsChangedDuringMove ||= deferColumns;
      cardsChangedDuringMove ||= deferCards;
      const columnsRead = deferColumns ? null : beginColumnsRead();
      const cardsLoading = deferCards ? Promise.resolve() : loadCards(boardId, isCurrent);
      // Events missed outside the room may have changed the labels and the open feeds as well.
      const sideLoads = Promise.all([
        cardsLoading,
        loadLabels(boardId, isCurrent),
        reloadFeeds(boardId),
      ]);
      try {
        const [board, columns, members] = await Promise.all([
          boardsApi.getBoard(boardId),
          columnsRead ? columnsApi.listColumns(boardId) : Promise.resolve(null),
          boardsApi.listMembers(boardId),
        ]);
        await sideLoads;
        if (isLatestSnapshot()) {
          set({
            board,
            members,
            boardStatus: 'ready',
            boardError: null,
            ...(columns && columnsRead?.isLatest() ? { columns: sortByRank(columns) } : {}),
          });
        }
        return 'ok';
      } catch (error) {
        await sideLoads;
        if (!isLatestSnapshot()) {
          return 'ok';
        }
        if (isAccessLostError(error)) {
          return 'access-lost';
        }
        // A resync started while the board was still opening has superseded that load.
        set((current) =>
          current.boardStatus === 'loading'
            ? { boardStatus: 'error', boardError: getBoardErrorMessage(error) }
            : { notice: getBoardErrorMessage(error) },
        );
        return 'error';
      } finally {
        columnsRead?.settle();
      }
    },

    forgetBoard: (boardId) => {
      removeBoardFromList(boardId);
      if (get().boardId === boardId) {
        forgetOpenedBoard();
      }
    },
  };
});

/** Clears all board data and drops the results of requests in flight. */
export function resetBoardStore(): void {
  boardGeneration += 1;
  boardsGeneration += 1;
  cardsGeneration += 1;
  pendingCardsLoad = null;
  columnsGeneration += 1;
  pendingColumnsLoad = null;
  snapshotGeneration += 1;
  labelsGeneration += 1;
  pendingLabelsLoad = null;
  clearCardEditTracking();
  columnMoveInFlight = null;
  cardMoveInFlight = null;
  columnsChangedDuringMove = false;
  cardsChangedDuringMove = false;
  resetFeedsExcept(null);
  useBoardStore.setState(initialState);
}

// Board data belongs to the session it was loaded in: forget it on logout or user change.
useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch !== previous.sessionEpoch || state.user?.id !== previous.user?.id) {
    resetBoardStore();
  }
});
