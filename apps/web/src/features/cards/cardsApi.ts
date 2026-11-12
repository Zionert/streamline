import {
  cardListResponseSchema,
  cardResponseSchema,
  type Card,
  type ColumnCards,
  type CreateCardInput,
  type MoveCardInput,
  type UpdateCardInput,
} from '@streamline/shared';

import { api } from '@/lib/api';

const cardsUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}/cards`;
const cardUrl = (boardId: string, cardIdOrKey: string) =>
  `${cardsUrl(boardId)}/${encodeURIComponent(cardIdOrKey)}`;

/** Every column of the board (also empty ones) with its cards, both in rank order. */
export async function listCards(boardId: string): Promise<ColumnCards[]> {
  const response = await api.get<unknown>(cardsUrl(boardId));
  return cardListResponseSchema.parse(response.data).columns;
}

/** A single card by its key, e.g. `SL-12`. */
export async function getCardByKey(boardId: string, cardKey: string): Promise<Card> {
  const response = await api.get<unknown>(cardUrl(boardId, cardKey));
  return cardResponseSchema.parse(response.data).card;
}

/** Creates a card at the end of the column; it gets the next number of the board. */
export async function createCard(boardId: string, input: CreateCardInput): Promise<Card> {
  const response = await api.post<unknown>(cardsUrl(boardId), input);
  return cardResponseSchema.parse(response.data).card;
}

/** Changes the given fields only; the column and position change only through `moveCard`. */
export async function updateCard(
  boardId: string,
  cardId: string,
  input: UpdateCardInput,
): Promise<Card> {
  const response = await api.patch<unknown>(cardUrl(boardId, cardId), input);
  return cardResponseSchema.parse(response.data).card;
}

/**
 * Moves a card next to the given neighbours of the target column. The response contains only the
 * moved card; if the server had to rebalance, the ranks of other cards changed as well.
 */
export async function moveCard(
  boardId: string,
  cardId: string,
  input: MoveCardInput,
): Promise<Card> {
  const response = await api.patch<unknown>(`${cardUrl(boardId, cardId)}/move`, input);
  return cardResponseSchema.parse(response.data).card;
}

export async function deleteCard(boardId: string, cardId: string): Promise<void> {
  await api.delete(cardUrl(boardId, cardId));
}
