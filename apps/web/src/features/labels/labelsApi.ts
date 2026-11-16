import {
  cardResponseSchema,
  labelListResponseSchema,
  labelResponseSchema,
  type Card,
  type CreateLabelInput,
  type Label,
  type UpdateLabelInput,
} from '@streamline/shared';

import { api } from '@/lib/api';

const labelsUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}/labels`;
const labelUrl = (boardId: string, labelId: string) =>
  `${labelsUrl(boardId)}/${encodeURIComponent(labelId)}`;
const cardLabelUrl = (boardId: string, cardId: string, labelId: string) =>
  `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}/labels/${encodeURIComponent(labelId)}`;

/** The board's labels in creation order (the order of `labelIds` on cards). */
export async function listLabels(boardId: string): Promise<Label[]> {
  const response = await api.get<unknown>(labelsUrl(boardId));
  return labelListResponseSchema.parse(response.data).labels;
}

export async function createLabel(boardId: string, input: CreateLabelInput): Promise<Label> {
  const response = await api.post<unknown>(labelsUrl(boardId), input);
  return labelResponseSchema.parse(response.data).label;
}

export async function updateLabel(
  boardId: string,
  labelId: string,
  input: UpdateLabelInput,
): Promise<Label> {
  const response = await api.patch<unknown>(labelUrl(boardId, labelId), input);
  return labelResponseSchema.parse(response.data).label;
}

/** Deletes the label; the server removes it from every card as well. */
export async function deleteLabel(boardId: string, labelId: string): Promise<void> {
  await api.delete(labelUrl(boardId, labelId));
}

/** Attaches the label to the card (idempotent); returns the card with its new `labelIds`. */
export async function attachLabel(boardId: string, cardId: string, labelId: string): Promise<Card> {
  const response = await api.put<unknown>(cardLabelUrl(boardId, cardId, labelId));
  return cardResponseSchema.parse(response.data).card;
}

/** Removes the label from the card (idempotent); returns the card with its new `labelIds`. */
export async function detachLabel(boardId: string, cardId: string, labelId: string): Promise<Card> {
  const response = await api.delete<unknown>(cardLabelUrl(boardId, cardId, labelId));
  return cardResponseSchema.parse(response.data).card;
}
