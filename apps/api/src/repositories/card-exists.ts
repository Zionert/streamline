import type { QueryClient } from './board-transaction.js';

/** Whether the card exists in the board (a card of another board counts as missing). */
export async function cardExistsInBoard(
  db: QueryClient,
  boardId: string,
  cardId: string,
): Promise<boolean> {
  return (await db.card.count({ where: { id: cardId, boardId } })) > 0;
}
