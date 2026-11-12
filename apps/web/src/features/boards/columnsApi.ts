import {
  columnListResponseSchema,
  columnResponseSchema,
  type Column,
  type CreateColumnInput,
  type MoveColumnInput,
  type RenameColumnInput,
  type UpdateColumnSettingsInput,
} from '@streamline/shared';

import { api } from '@/lib/api';

const columnsUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}/columns`;
const columnUrl = (boardId: string, columnId: string) =>
  `${columnsUrl(boardId)}/${encodeURIComponent(columnId)}`;

/** Columns of the board in rank order. */
export async function listColumns(boardId: string): Promise<Column[]> {
  const response = await api.get<unknown>(columnsUrl(boardId));
  return columnListResponseSchema.parse(response.data).columns;
}

export async function createColumn(boardId: string, input: CreateColumnInput): Promise<Column> {
  const response = await api.post<unknown>(columnsUrl(boardId), input);
  return columnResponseSchema.parse(response.data).column;
}

export async function renameColumn(
  boardId: string,
  columnId: string,
  input: RenameColumnInput,
): Promise<Column> {
  const response = await api.patch<unknown>(columnUrl(boardId, columnId), input);
  return columnResponseSchema.parse(response.data).column;
}

/**
 * Moves a column next to the given neighbours. The response contains only the moved column; if
 * the server had to rebalance, the ranks of other columns changed as well.
 */
export async function moveColumn(
  boardId: string,
  columnId: string,
  input: MoveColumnInput,
): Promise<Column> {
  const response = await api.patch<unknown>(`${columnUrl(boardId, columnId)}/move`, input);
  return columnResponseSchema.parse(response.data).column;
}

export async function updateColumnSettings(
  boardId: string,
  columnId: string,
  input: UpdateColumnSettingsInput,
): Promise<Column> {
  const response = await api.patch<unknown>(`${columnUrl(boardId, columnId)}/settings`, input);
  return columnResponseSchema.parse(response.data).column;
}

export async function deleteColumn(boardId: string, columnId: string): Promise<void> {
  await api.delete(columnUrl(boardId, columnId));
}
