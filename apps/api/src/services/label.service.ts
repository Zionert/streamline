import {
  LABEL_ERROR_CODES,
  LABELS_PER_BOARD_MAX,
  type CreateLabelInput,
  type Label,
  type UpdateLabelInput,
} from '@streamline/shared';

import { ConflictError, NotFoundError } from '../errors/app-error.js';
import { noopBoardEvents, type BoardEvents, type ChangeOrigin } from '../realtime/board-events.js';
import {
  LabelNameTakenError,
  type LabelRecord,
  type LabelRepository,
} from '../repositories/label.repository.js';
import { assertBoardPermission, type BoardMembership } from './board-access.service.js';
import { inLockedBoard } from './ranked-write.js';

/**
 * Board labels (attaching them to cards belongs to `CardService`).
 *
 * Concurrency: creation takes the exclusive board lock, so the per-board limit is checked
 * against a stable count; renames, color changes and deletes take the shared lock (the unique
 * index rejects duplicate names). An update that changes nothing writes and broadcasts nothing.
 * Deleting a label removes it from every card (cascade); the clients drop the id from their cards
 * on `label:deleted`.
 */
export interface LabelService {
  /** The board's labels in creation order. */
  list(membership: BoardMembership): Promise<Label[]>;
  create(
    membership: BoardMembership,
    input: CreateLabelInput,
    origin?: ChangeOrigin,
  ): Promise<Label>;
  update(
    membership: BoardMembership,
    labelId: string,
    input: UpdateLabelInput,
    origin?: ChangeOrigin,
  ): Promise<Label>;
  delete(membership: BoardMembership, labelId: string, origin?: ChangeOrigin): Promise<void>;
}

export interface LabelServiceDependencies {
  labels: LabelRepository;
  events?: BoardEvents;
}

export function toLabel(label: LabelRecord): Label {
  return {
    id: label.id,
    boardId: label.boardId,
    name: label.name,
    color: label.color,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  };
}

export function labelNotFound(): NotFoundError {
  return new NotFoundError('Label not found in this board', LABEL_ERROR_CODES.LABEL_NOT_FOUND);
}

/** Maps a duplicate name to 409 `LABEL_NAME_TAKEN`; returns other errors unchanged. */
function nameTakenToConflict(err: unknown): unknown {
  if (err instanceof LabelNameTakenError) {
    return new ConflictError(
      'Another label of this board already has this name',
      LABEL_ERROR_CODES.LABEL_NAME_TAKEN,
    );
  }
  return err;
}

export function createLabelService({
  labels,
  events = noopBoardEvents,
}: LabelServiceDependencies): LabelService {
  return {
    async list(membership) {
      assertBoardPermission(membership, 'board:view');
      return (await labels.listForBoard(membership.boardId)).map(toLabel);
    },

    async create(membership, { name, color }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      let created: LabelRecord;
      try {
        created = await inLockedBoard(labels, boardId, 'exclusive', async (store) => {
          if ((await store.countForBoard(boardId)) >= LABELS_PER_BOARD_MAX) {
            throw new ConflictError(
              `A board can have at most ${String(LABELS_PER_BOARD_MAX)} labels`,
              LABEL_ERROR_CODES.LABEL_LIMIT_REACHED,
            );
          }
          return store.create({ boardId, name, color });
        });
      } catch (err) {
        throw nameTakenToConflict(err);
      }
      const label = toLabel(created);
      events.publish('label:created', { boardId, actorId: userId, label }, origin);
      return label;
    },

    async update(membership, labelId, { name, color }, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      let outcome: { label: LabelRecord; changed: boolean };
      try {
        outcome = await inLockedBoard(labels, boardId, 'shared', async (store) => {
          const current = await store.lockLabel(boardId, labelId);
          if (!current) throw labelNotFound();
          const unchanged =
            (name === undefined || name === current.name) &&
            (color === undefined || color === current.color);
          // Nothing to change: no write (`updatedAt` stays) and nothing to broadcast.
          if (unchanged) return { label: current, changed: false };
          const result = await store.update(boardId, labelId, { name, color });
          if (!result) throw labelNotFound();
          return { label: result, changed: true };
        });
      } catch (err) {
        throw nameTakenToConflict(err);
      }
      const label = toLabel(outcome.label);
      if (outcome.changed) {
        events.publish('label:updated', { boardId, actorId: userId, label }, origin);
      }
      return label;
    },

    async delete(membership, labelId, origin) {
      assertBoardPermission(membership, 'card:write');
      const { boardId, userId } = membership;
      await inLockedBoard(labels, boardId, 'shared', async (store) => {
        if (!(await store.delete(boardId, labelId))) throw labelNotFound();
      });
      events.publish('label:deleted', { boardId, actorId: userId, labelId }, origin);
    },
  };
}
