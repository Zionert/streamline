import { rankSequenceBetween } from '@streamline/shared';

import type { DbClient } from '../repositories/db.js';

/** A move of a card into a column at an instant (ISO string or Date). */
export type FlowMove = readonly [at: string | Date, columnId: string];

export interface FlowCardSpec {
  title?: string;
  /** Defaults to the instant of the first move. */
  createdAt?: string | Date;
  /** The first move is the creation of the card; the card ends up in the column of the last. */
  moves: readonly FlowMove[];
  assigneeId?: string | null;
}

export interface InsertedFlowCard {
  id: string;
  number: number;
  title: string;
}

const toDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

/**
 * Inserts backdated cards with their transitions directly (bulk inserts, no activity entries),
 * for flow analytics tests. Card numbers continue the board's counter; ranks are appended after
 * the cards already in each column. Returns the cards in the order of `specs`.
 */
export async function insertFlowCards(
  db: DbClient,
  boardId: string,
  specs: readonly FlowCardSpec[],
): Promise<InsertedFlowCard[]> {
  if (specs.length === 0) return [];
  const board = await db.board.update({
    where: { id: boardId },
    data: { nextCardNumber: { increment: specs.length } },
    select: { nextCardNumber: true },
  });
  const firstNumber = board.nextCardNumber - specs.length;

  const finalColumn = specs.map((spec) => {
    const last = spec.moves.at(-1);
    if (!last) throw new Error('A flow card needs at least one move');
    return last[1];
  });

  const ranks = new Map<string, string[]>();
  for (const columnId of new Set(finalColumn)) {
    const count = finalColumn.filter((id) => id === columnId).length;
    const last = await db.card.findFirst({
      where: { columnId },
      orderBy: { rank: 'desc' },
      select: { rank: true },
    });
    ranks.set(columnId, rankSequenceBetween(last?.rank ?? null, null, count));
  }

  const rows = specs.map((spec, index) => {
    const columnId = finalColumn[index] ?? '';
    const rank = ranks.get(columnId)?.shift();
    if (rank === undefined) throw new Error('Rank missing');
    const createdAt = toDate(spec.createdAt ?? spec.moves[0]?.[0] ?? new Date());
    const lastMove = spec.moves.at(-1);
    return {
      boardId,
      columnId,
      number: firstNumber + index,
      title: spec.title ?? `Card ${String(firstNumber + index)}`,
      rank,
      assigneeId: spec.assigneeId ?? null,
      createdAt,
      updatedAt: lastMove ? toDate(lastMove[0]) : createdAt,
    };
  });
  const cards = await db.card.createManyAndReturn({
    data: rows,
    select: { id: true, number: true, title: true },
  });
  const byNumber = new Map(cards.map((card) => [card.number, card]));
  const ordered = rows.map((row) => {
    const card = byNumber.get(row.number);
    if (!card) throw new Error('Inserted card missing');
    return card;
  });

  await db.cardTransition.createMany({
    data: specs.flatMap((spec, index) =>
      spec.moves.map(([at, columnId], moveIndex) => ({
        cardId: ordered[index]?.id ?? '',
        boardId,
        fromColumnId: moveIndex === 0 ? null : (spec.moves[moveIndex - 1]?.[1] ?? null),
        toColumnId: columnId,
        movedById: null,
        movedAt: toDate(at),
      })),
    ),
  });
  return ordered;
}
