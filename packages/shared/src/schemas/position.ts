import { z } from 'zod';

/** Id of a neighbouring item; `null` stands for the open end of the list. */
export const neighborIdSchema = z.string().min(1).nullable().optional();

/**
 * Position of an item relative to its future neighbours (`afterId` precedes it, `beforeId`
 * follows it). The server computes the `rank` from the persisted ranks of these neighbours;
 * clients never send ranks.
 */
export const positionShape = {
  afterId: neighborIdSchema,
  beforeId: neighborIdSchema,
};

export interface PositionInput {
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

/** Refinement: `afterId` and `beforeId` must not name the same item. */
export const distinctNeighbors = (value: PositionInput): boolean =>
  typeof value.afterId !== 'string' || value.afterId !== value.beforeId;

/** Issue reported by {@link distinctNeighbors}; `noun` is the kind of item, e.g. `columns`. */
export const distinctNeighborsIssue = (noun: string) => ({
  message: `afterId and beforeId must be different ${noun}`,
  path: ['beforeId'],
});
