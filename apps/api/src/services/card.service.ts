import {
  CARD_ERROR_CODES,
  formatCardKey,
  LABEL_ERROR_CODES,
  LABELS_PER_CARD_MAX,
  type ActivityCardField,
  type Card,
  type ColumnCards,
  type CreateCardInput,
  type MoveCardInput,
  type ParsedCardKey,
  type UpdateCardInput,
  type WipLimitExceededDetails,
} from '@streamline/shared';

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import type { ActivityRecord } from '../repositories/activity.repository.js';
import type { RankAssignment } from '../repositories/board-transaction.js';
import type {
  CardChanges,
  CardColumn,
  CardRecord,
  CardRepository,
  CardStore,
  LockedCard,
} from '../repositories/card.repository.js';
import { publishActivity } from './activity-publisher.js';
import { labelNotFound } from './label.service.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';
import {
  busyToServiceUnavailable,
  inLockedBoard,
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
 * Concurrency (lock order: board row → membership row → card row → column / label row, never the
 * reverse):
 * - every write locks the board row first (shared, or exclusive where noted), so it cannot
 *   interleave with the deletion of the board, and writes the activity entry describing it in
 *   the same transaction (only the committed attempt of a retried write leaves an entry),
 * - moves take the shared board lock and lock the moved card's row, so concurrent moves of
 *   different cards run in parallel and rank collisions are retried as for columns,
 * - creation takes the exclusive board lock, because it increments the board's card counter
 *   (an UPDATE of the board row, which would deadlock with other shared holders),
 * - a card entering a column with a strict WIP limit locks the column row before counting its
 *   cards, so two cards can never take the last free slot at the same time,
 * - the board lock also keeps the WIP settings stable (they change under the exclusive lock)
 *   and stops a column from being deleted while a card is being added to it,
 * - assigning a user locks their membership row (before the card row, like the removal of a
 *   member, which unassigns the user's cards), so the removal cannot leave a card assigned to a
 *   non-member,
 * - attaching a label locks the card row before counting its labels (the per-card limit) and
 *   the label row `FOR SHARE`, so a concurrently deleted label is never attached.
 *
 * Committed changes are broadcast through `BoardEvents`; a rebalance of a column is announced
 * first with `cards:rebalanced` (the new ranks of the column's cards), then the change itself,
 * then the activity entry (`activity:created`).
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
  /** Attaches a board label to the card; attaching an attached label changes nothing. */
  attachLabel(
    membership: BoardMembership,
    cardId: string,
    labelId: string,
    origin?: ChangeOrigin,
  ): Promise<Card>;
  /** Removes a board label from the card; removing a label that is not attached changes nothing. */
  detachLabel(
    membership: BoardMembership,
    cardId: string,
    labelId: string,
    origin?: ChangeOrigin,
  ): Promise<Card>;
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

/** Result of a committed card write: the card and the activity entry describing the change. */
interface CardWrite {
  card: CardRecord;
  activity: ActivityRecord | null;
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
    labelIds: card.labels.map((label) => label.labelId),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

/** Fields whose value differs between two versions of a card, in the API's field order. */
export function changedCardFields(before: CardRecord, after: CardRecord): ActivityCardField[] {
  const dueDate = (card: CardRecord) =>
    card.dueDate === null ? null : formatDueDate(card.dueDate);
  const fields: ActivityCardField[] = [];
  if (before.title !== after.title) fields.push('title');
  if (before.description !== after.description) fields.push('description');
  if (before.priority !== after.priority) fields.push('priority');
  if (before.assigneeId !== after.assigneeId) fields.push('assigneeId');
  if (dueDate(before) !== dueDate(after)) fields.push('dueDate');
  return fields;
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
  /**
   * Broadcasts the new ranks of a committed rebalance (if any), then the card change, then the
   * activity entry (if any).
   */
  function publishCard(
    name: 'card:created' | 'card:updated' | 'card:moved',
    membership: BoardMembership,
    card: Card,
    origin: ChangeOrigin | undefined,
    activity: ActivityRecord | null,
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
    publishActivity(events, membership, activity);
  }

  async function boardKeyOf(boardId: string): Promise<string> {
    const key = await cards.findBoardKey(boardId);
    if (key === null) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
    return key;
  }

  async function withKey(card: CardRecord): Promise<Card> {
    return toCard(card, await boardKeyOf(card.boardId));
  }

  /** The card as described in activity entries (key and title at the time of the change). */
  async function cardSnapshot(
    store: CardStore,
    boardId: string,
    card: Pick<LockedCard, 'number' | 'title'>,
  ): Promise<{ key: string; title: string }> {
    const boardKey = await store.findBoardKey(boardId);
    if (boardKey === null) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
    return { key: formatCardKey(boardKey, card.number), title: card.title };
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
   * For a card entering `column`: throws `WIP_LIMIT_EXCEEDED` (with the column and its limit in
   * `details`) when the column has a strict WIP limit and is full. The column row is locked
   * before counting, so concurrent entries are serialized and each one counts the cards
   * committed by the others.
   */
  async function assertWipAllowsEntry(store: CardStore, boardId: string, column: CardColumn) {
    if (!column.wipStrict || column.wipLimit === null) return;
    if (!(await store.lockColumn(boardId, column.id))) throw columnNotFound();
    if ((await store.countInColumn(column.id)) >= column.wipLimit) {
      const details: WipLimitExceededDetails = {
        columnId: column.id,
        columnName: column.title,
        wipLimit: column.wipLimit,
      };
      throw new ConflictError(
        `The column has a strict WIP limit of ${String(column.wipLimit)} cards and is full`,
        CARD_ERROR_CODES.WIP_LIMIT_EXCEEDED,
        details,
      );
    }
  }

  /** Runs a single-attempt card write holding the shared board lock (503 `BOARD_BUSY`). */
  function inSharedBoard<T>(boardId: string, fn: (store: CardStore) => Promise<T>): Promise<T> {
    return inLockedBoard(cards, boardId, 'shared', fn);
  }

  /**
   * Returns the card after a label change and broadcasts it as `card:updated` (with its new
   * `labelIds`); a request that changed nothing (`null`) only reads the card.
   */
  async function finishLabelChange(
    membership: BoardMembership,
    cardId: string,
    result: CardWrite | null,
    origin: ChangeOrigin | undefined,
  ): Promise<Card> {
    if (!result) {
      const current = await cards.findById(membership.boardId, cardId);
      if (!current) throw cardNotFound();
      return withKey(current);
    }
    const card = await withKey(result.card);
    publishCard('card:updated', membership, card, origin, result.activity);
    return card;
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
        async ({ store }): Promise<CardWrite> => {
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
          const activity = await store.recordActivity({
            boardId,
            actorId: userId,
            cardId: card.id,
            content: {
              type: 'CARD_CREATED',
              payload: {
                card: await cardSnapshot(store, boardId, card),
                column: { id: column.id, name: column.title },
              },
            },
          });
          return { card, activity };
        },
        'exclusive',
      );
      const card = await withKey(created.card);
      publishCard('card:created', membership, card, origin, created.activity, rebalanced);
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
      const { boardId, userId } = membership;
      const changes: CardChanges = {
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId,
        dueDate: dueDateChange(input.dueDate),
      };

      const updated = await inSharedBoard(boardId, async (store): Promise<CardWrite> => {
        if (typeof input.assigneeId === 'string') {
          await assertAssignable(store, boardId, input.assigneeId);
        }
        if (!(await store.lockCard(boardId, cardId))) throw cardNotFound();
        const before = await store.findById(boardId, cardId);
        if (!before) throw cardNotFound();
        const card = await store.update(boardId, cardId, changes);
        if (!card) throw cardNotFound();

        const fields = changedCardFields(before, card);
        if (fields.length === 0) return { card, activity: null };
        const activity = await store.recordActivity({
          boardId,
          actorId: userId,
          cardId,
          content: {
            type: 'CARD_UPDATED',
            payload: {
              card: await cardSnapshot(store, boardId, card),
              fields,
              ...(fields.includes('title') && { title: { from: before.title, to: card.title } }),
            },
          },
        });
        return { card, activity };
      });
      const card = await withKey(updated.card);
      publishCard('card:updated', membership, card, origin, updated.activity);
      return card;
    },

    async move(membership, cardId, { columnId, afterId, beforeId }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      if (afterId === cardId || beforeId === cardId) {
        throw new ValidationError('A card cannot be its own neighbor');
      }
      let rebalanced: ColumnRebalance | null = null;

      const moved = await withRankRetry(
        cards,
        boardId,
        async ({ store, lock, positionMode }): Promise<CardWrite> => {
          rebalanced = null;
          const card = await store.lockCard(boardId, cardId);
          if (!card) throw cardNotFound();
          const target = await store.findColumn(boardId, columnId);
          if (!target) throw columnNotFound();

          const others = (await store.listInColumn(columnId)).filter(
            (entry) => entry.id !== cardId,
          );
          const index = resolveInsertIndex(
            others,
            { afterId, beforeId },
            positionMode,
            NEIGHBOR_NOT_FOUND_MESSAGE,
          );
          const entering = card.columnId !== columnId;
          if (!entering && isAtIndex(others, index, card.rank)) {
            // Already at the requested position.
            const current = await store.findById(boardId, cardId);
            if (!current) throw cardNotFound();
            return { card: current, activity: null };
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
          // Reordering within a column is neither a transition nor an activity entry.
          if (!entering) return { card: updated, activity: null };

          await store.recordTransition({
            cardId,
            boardId,
            fromColumnId: card.columnId,
            toColumnId: columnId,
            movedById: userId,
          });
          // The source column cannot be deleted meanwhile: deletion needs the exclusive lock.
          const source = await store.findColumn(boardId, card.columnId);
          if (!source) throw columnNotFound();
          const activity = await store.recordActivity({
            boardId,
            actorId: userId,
            cardId,
            content: {
              type: 'CARD_MOVED',
              payload: {
                card: await cardSnapshot(store, boardId, updated),
                from: { id: source.id, name: source.title },
                to: { id: target.id, name: target.title },
              },
            },
          });
          return { card: updated, activity };
        },
      );
      const card = await withKey(moved.card);
      publishCard('card:moved', membership, card, origin, moved.activity, rebalanced);
      return card;
    },

    async delete(membership, cardId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const activity = await inSharedBoard(boardId, async (store) => {
        const card = await store.lockCard(boardId, cardId);
        if (!card) throw cardNotFound();
        const column = await store.findColumn(boardId, card.columnId);
        if (!column) throw columnNotFound();
        const snapshot = await cardSnapshot(store, boardId, card);
        if (!(await store.delete(boardId, cardId))) throw cardNotFound();
        return store.recordActivity({
          boardId,
          actorId: userId,
          cardId,
          content: {
            type: 'CARD_DELETED',
            payload: { card: snapshot, column: { id: column.id, name: column.title } },
          },
        });
      });
      events.publish('card:deleted', { boardId, actorId: userId, cardId }, origin);
      publishActivity(events, membership, activity);
    },

    async attachLabel(membership, cardId, labelId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const result = await inSharedBoard(boardId, async (store): Promise<CardWrite | null> => {
        const card = await store.lockCard(boardId, cardId);
        if (!card) throw cardNotFound();
        const label = await store.lockLabel(boardId, labelId);
        if (!label) throw labelNotFound();
        const attached = await store.listLabelIds(cardId);
        if (attached.includes(labelId)) return null;
        if (attached.length >= LABELS_PER_CARD_MAX) {
          throw new ConflictError(
            `A card can carry at most ${String(LABELS_PER_CARD_MAX)} labels`,
            LABEL_ERROR_CODES.CARD_LABEL_LIMIT_REACHED,
          );
        }
        await store.attachLabel(cardId, labelId);
        const touched = await store.touch(boardId, cardId);
        if (!touched) throw cardNotFound();
        const activity = await store.recordActivity({
          boardId,
          actorId: userId,
          cardId,
          content: {
            type: 'CARD_LABEL_ADDED',
            payload: { card: await cardSnapshot(store, boardId, card), label },
          },
        });
        return { card: touched, activity };
      });
      return finishLabelChange(membership, cardId, result, origin);
    },

    async detachLabel(membership, cardId, labelId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      const result = await inSharedBoard(boardId, async (store): Promise<CardWrite | null> => {
        const card = await store.lockCard(boardId, cardId);
        if (!card) throw cardNotFound();
        const label = await store.lockLabel(boardId, labelId);
        if (!label) throw labelNotFound();
        if (!(await store.detachLabel(cardId, labelId))) return null;
        const touched = await store.touch(boardId, cardId);
        if (!touched) throw cardNotFound();
        const activity = await store.recordActivity({
          boardId,
          actorId: userId,
          cardId,
          content: {
            type: 'CARD_LABEL_REMOVED',
            payload: { card: await cardSnapshot(store, boardId, card), label },
          },
        });
        return { card: touched, activity };
      });
      return finishLabelChange(membership, cardId, result, origin);
    },
  };
}
