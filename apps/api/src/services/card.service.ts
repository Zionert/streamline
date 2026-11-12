import {
  CARD_ERROR_CODES,
  formatCardKey,
  type Card,
  type ColumnCards,
  type CreateCardInput,
  type MoveCardInput,
  type ParsedCardKey,
  type UpdateCardInput,
} from '@streamline/shared';

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import type { RankAssignment } from '../repositories/board-transaction.js';
import type {
  CardChanges,
  CardColumn,
  CardRecord,
  CardRepository,
  CardStore,
} from '../repositories/card.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';
import {
  busyToServiceUnavailable,
  isAtIndex,
  rankAt,
  rebalanceAroundNewItem,
  rebalancedAssignments,
  RebalanceRequiredError,
  resolveInsertIndex,
  withRankRetry,
} from './ranked-write.js';

/**
 * Card use cases (methods take the caller's membership verified by `BoardAccessService` and
 * re-check the role themselves).
 *
 * Concurrency (lock order: board row → card row → column row, never the reverse):
 * - moves take the shared board lock and lock the moved card's row, so concurrent moves of
 *   different cards run in parallel and rank collisions are retried as for columns,
 * - creation takes the exclusive board lock, because it increments the board's card counter
 *   (an UPDATE of the board row, which would deadlock with other shared holders),
 * - a card entering a column with a strict WIP limit locks the column row before counting its
 *   cards, so two cards can never take the last free slot at the same time,
 * - the board lock also keeps the WIP settings stable (they change under the exclusive lock)
 *   and stops a column from being deleted while a card is being added to it,
 * - assigning a user locks their membership row, so a concurrent removal from the board (which
 *   unassigns the user's cards) cannot leave a card assigned to a non-member.
 *
 * Committed changes are broadcast through `BoardEvents`; a rebalance of a column is announced
 * first with `cards:rebalanced` (the new ranks of the column's cards), then the change itself.
 */
export interface CardService {
  /** All columns of the board in rank order, each with its cards in rank order. */
  list(membership: BoardMembership): Promise<ColumnCards[]>;
  /** Appends a card to the end of a column and records its first transition. */
  create(membership: BoardMembership, input: CreateCardInput, origin?: ChangeOrigin): Promise<Card>;
  /** Finds a card by key; the prefix must be the board's current key. */
  getByKey(membership: BoardMembership, key: ParsedCardKey): Promise<Card>;
  update(
    membership: BoardMembership,
    cardId: string,
    input: UpdateCardInput,
    origin?: ChangeOrigin,
  ): Promise<Card>;
  /** Moves a card within or between columns; a column change records a transition. */
  move(
    membership: BoardMembership,
    cardId: string,
    input: MoveCardInput,
    origin?: ChangeOrigin,
  ): Promise<Card>;
  delete(membership: BoardMembership, cardId: string, origin?: ChangeOrigin): Promise<void>;
}

export interface CardServiceDependencies {
  cards: CardRepository;
  events?: BoardEvents;
}

/** New ranks of the cards of one column, given by a rebalance. */
interface ColumnRebalance {
  columnId: string;
  ranks: RankAssignment[];
}

export const CARD_NOT_FOUND_MESSAGE = 'Card not found';

const NEIGHBOR_NOT_FOUND_MESSAGE = 'Neighbor card not found in the target column';

/** `YYYY-MM-DD` → the date at UTC midnight (how Prisma represents a `DATE`). */
export function parseDueDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A `DATE` read by Prisma (UTC midnight) → `YYYY-MM-DD`. */
export function formatDueDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toCard(card: CardRecord, boardKey: string): Card {
  return {
    id: card.id,
    key: formatCardKey(boardKey, card.number),
    number: card.number,
    boardId: card.boardId,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    rank: card.rank,
    priority: card.priority,
    assigneeId: card.assigneeId,
    dueDate: card.dueDate === null ? null : formatDueDate(card.dueDate),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function cardNotFound(): NotFoundError {
  return new NotFoundError(CARD_NOT_FOUND_MESSAGE);
}

function columnNotFound(): NotFoundError {
  return new NotFoundError('Column not found in this board', CARD_ERROR_CODES.COLUMN_NOT_FOUND);
}

/** `undefined` stays "not given", `null` clears the date. */
function dueDateChange(value: string | null | undefined): Date | null | undefined {
  return value === undefined || value === null ? value : parseDueDate(value);
}

export function createCardService({
  cards,
  events = noopBoardEvents,
}: CardServiceDependencies): CardService {
  /** Broadcasts the new ranks of a committed rebalance (if any), then the card change. */
  function publishCard(
    name: 'card:created' | 'card:updated' | 'card:moved',
    membership: BoardMembership,
    card: Card,
    origin: ChangeOrigin | undefined,
    rebalanced: ColumnRebalance | null = null,
  ): void {
    const { boardId, userId: actorId } = membership;
    if (rebalanced) {
      events.publish(
        'cards:rebalanced',
        { boardId, actorId, columnId: rebalanced.columnId, ranks: rebalanced.ranks },
        origin,
      );
    }
    events.publish(name, { boardId, actorId, card }, origin);
  }

  async function boardKeyOf(boardId: string): Promise<string> {
    const key = await cards.findBoardKey(boardId);
    if (key === null) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
    return key;
  }

  async function withKey(card: CardRecord): Promise<Card> {
    return toCard(card, await boardKeyOf(card.boardId));
  }

  /** Throws `ASSIGNEE_NOT_MEMBER` unless the user is (and stays, until commit) a board member. */
  async function assertAssignable(store: CardStore, boardId: string, userId: string) {
    if (!(await store.lockMembership(boardId, userId))) {
      throw new BadRequestError(
        'The assignee must be a member of the board',
        CARD_ERROR_CODES.ASSIGNEE_NOT_MEMBER,
      );
    }
  }

  /**
   * For a card entering `column`: throws `WIP_LIMIT_EXCEEDED` when the column has a strict WIP
   * limit and is full. The column row is locked before counting, so concurrent entries are
   * serialized and each one counts the cards committed by the others.
   */
  async function assertWipAllowsEntry(store: CardStore, boardId: string, column: CardColumn) {
    if (!column.wipStrict || column.wipLimit === null) return;
    if (!(await store.lockColumn(boardId, column.id))) throw columnNotFound();
    if ((await store.countInColumn(column.id)) >= column.wipLimit) {
      throw new ConflictError(
        `The column has a strict WIP limit of ${String(column.wipLimit)} cards and is full`,
        CARD_ERROR_CODES.WIP_LIMIT_EXCEEDED,
      );
    }
  }

  return {
    async list(membership) {
      assertBoardPermission(membership, 'board:view');
      let board;
      try {
        board = await cards.listBoard(membership.boardId);
      } catch (err) {
        throw busyToServiceUnavailable(err);
      }
      if (!board) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);

      const byColumn = new Map<string, Card[]>(board.columnIds.map((id) => [id, []]));
      for (const record of board.cards) {
        byColumn.get(record.columnId)?.push(toCard(record, board.boardKey));
      }
      return board.columnIds.map((columnId) => ({
        columnId,
        cards: byColumn.get(columnId) ?? [],
      }));
    },

    async create(membership, input, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const { columnId, assigneeId } = input;
      // Ranks given to the column's other cards by a rebalance in the attempt that succeeded.
      let rebalanced: ColumnRebalance | null = null;

      const created = await withRankRetry(
        cards,
        boardId,
        async ({ store }) => {
          rebalanced = null;
          const column = await store.findColumn(boardId, columnId);
          if (!column) throw columnNotFound();
          if (typeof assigneeId === 'string') await assertAssignable(store, boardId, assigneeId);

          const others = await store.listInColumn(columnId);
          await assertWipAllowsEntry(store, boardId, column);

          // The exclusive board lock is held, so the column can be rebalanced right away.
          let rank = rankAt(others, others.length);
          if (rank === null) {
            const result = rebalanceAroundNewItem(others, others.length);
            await store.setRanks(columnId, result.assignments);
            rebalanced = { columnId, ranks: result.assignments };
            rank = result.rank;
          }

          const card = await store.create({
            boardId,
            columnId,
            number: await store.allocateNumber(boardId),
            title: input.title,
            description: input.description ?? null,
            rank,
            priority: input.priority,
            assigneeId: assigneeId ?? null,
            dueDate: dueDateChange(input.dueDate) ?? null,
          });
          await store.recordTransition({
            cardId: card.id,
            boardId,
            fromColumnId: null,
            toColumnId: columnId,
            movedById: userId,
          });
          return card;
        },
        'exclusive',
      );
      const card = await withKey(created);
      publishCard('card:created', membership, card, origin, rebalanced);
      return card;
    },

    async getByKey(membership, { boardKey, number }) {
      assertBoardPermission(membership, 'board:view');
      const { boardId } = membership;
      const currentKey = await boardKeyOf(boardId);
      if (currentKey !== boardKey) throw cardNotFound();
      const card = await cards.findByNumber(boardId, number);
      if (!card) throw cardNotFound();
      return toCard(card, currentKey);
    },

    async update(membership, cardId, input, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId } = membership;
      const changes: CardChanges = {
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId,
        dueDate: dueDateChange(input.dueDate),
      };

      let updated: CardRecord | null;
      try {
        updated = await cards.transaction(async (store) => {
          if (typeof input.assigneeId === 'string') {
            await assertAssignable(store, boardId, input.assigneeId);
          }
          return store.update(boardId, cardId, changes);
        });
      } catch (err) {
        throw busyToServiceUnavailable(err);
      }
      if (!updated) throw cardNotFound();
      const card = await withKey(updated);
      publishCard('card:updated', membership, card, origin);
      return card;
    },

    async move(membership, cardId, { columnId, afterId, beforeId }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      if (afterId === cardId || beforeId === cardId) {
        throw new ValidationError('A card cannot be its own neighbor');
      }
      let rebalanced: ColumnRebalance | null = null;

      const moved = await withRankRetry(cards, boardId, async ({ store, lock, positionMode }) => {
        rebalanced = null;
        const card = await store.lockCard(boardId, cardId);
        if (!card) throw cardNotFound();
        const target = await store.findColumn(boardId, columnId);
        if (!target) throw columnNotFound();

        const others = (await store.listInColumn(columnId)).filter((entry) => entry.id !== cardId);
        const index = resolveInsertIndex(
          others,
          { afterId, beforeId },
          positionMode,
          NEIGHBOR_NOT_FOUND_MESSAGE,
        );
        const entering = card.columnId !== columnId;
        if (!entering && isAtIndex(others, index, card.rank)) {
          return store.findById(boardId, cardId); // Already at the requested position.
        }
        if (entering) await assertWipAllowsEntry(store, boardId, target);

        let rank = rankAt(others, index);
        if (rank === null) {
          if (lock === 'shared') throw new RebalanceRequiredError();
          if (entering) {
            const result = rebalanceAroundNewItem(others, index);
            await store.setRanks(columnId, result.assignments);
            rebalanced = { columnId, ranks: result.assignments };
            rank = result.rank;
          } else {
            // The moved card is rewritten in the same statement, as its old rank may be reused.
            const ordered = others.map((entry) => entry.id);
            ordered.splice(index, 0, cardId);
            const assignments = rebalancedAssignments(ordered);
            await store.setRanks(columnId, assignments);
            rebalanced = { columnId, ranks: assignments };
            rank = assignments[index]?.rank ?? null;
            if (rank === null) throw new Error('Missing rank for the moved card');
          }
        }

        const updated = await store.updatePosition(boardId, cardId, columnId, rank);
        if (!updated) throw cardNotFound();
        if (entering) {
          await store.recordTransition({
            cardId,
            boardId,
            fromColumnId: card.columnId,
            toColumnId: columnId,
            movedById: userId,
          });
        }
        return updated;
      });
      if (!moved) throw cardNotFound();
      const card = await withKey(moved);
      publishCard('card:moved', membership, card, origin, rebalanced);
      return card;
    },

    async delete(membership, cardId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      let deleted: boolean;
      try {
        deleted = await cards.delete(boardId, cardId);
      } catch (err) {
        throw busyToServiceUnavailable(err);
      }
      if (!deleted) throw cardNotFound();
      events.publish('card:deleted', { boardId, actorId: userId, cardId }, origin);
    },
  };
}
