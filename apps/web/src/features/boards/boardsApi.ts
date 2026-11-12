import {
  boardListResponseSchema,
  boardMemberListResponseSchema,
  boardMemberResponseSchema,
  boardResponseSchema,
  type AddBoardMemberInput,
  type AssignableBoardRole,
  type Board,
  type BoardMember,
  type CreateBoardInput,
  type UpdateBoardInput,
} from '@streamline/shared';

import { api } from '@/lib/api';

const boardUrl = (boardId: string) => `/boards/${encodeURIComponent(boardId)}`;
const membersUrl = (boardId: string) => `${boardUrl(boardId)}/members`;
const memberUrl = (boardId: string, userId: string) =>
  `${membersUrl(boardId)}/${encodeURIComponent(userId)}`;

/** Boards the current user belongs to, newest first. */
export async function listBoards(): Promise<Board[]> {
  const response = await api.get<unknown>('/boards');
  return boardListResponseSchema.parse(response.data).boards;
}

export async function getBoard(boardId: string): Promise<Board> {
  const response = await api.get<unknown>(boardUrl(boardId));
  return boardResponseSchema.parse(response.data).board;
}

/** Creates a board; the current user becomes its owner. */
export async function createBoard(input: CreateBoardInput): Promise<Board> {
  const response = await api.post<unknown>('/boards', input);
  return boardResponseSchema.parse(response.data).board;
}

export async function renameBoard(boardId: string, input: UpdateBoardInput): Promise<Board> {
  const response = await api.patch<unknown>(boardUrl(boardId), input);
  return boardResponseSchema.parse(response.data).board;
}

export async function deleteBoard(boardId: string): Promise<void> {
  await api.delete(boardUrl(boardId));
}

export async function listMembers(boardId: string): Promise<BoardMember[]> {
  const response = await api.get<unknown>(membersUrl(boardId));
  return boardMemberListResponseSchema.parse(response.data).members;
}

export async function addMember(boardId: string, input: AddBoardMemberInput): Promise<BoardMember> {
  const response = await api.post<unknown>(membersUrl(boardId), input);
  return boardMemberResponseSchema.parse(response.data).member;
}

export async function updateMemberRole(
  boardId: string,
  userId: string,
  role: AssignableBoardRole,
): Promise<BoardMember> {
  const response = await api.patch<unknown>(memberUrl(boardId, userId), { role });
  return boardMemberResponseSchema.parse(response.data).member;
}

/** Removes a member; removing yourself means leaving the board. */
export async function removeMember(boardId: string, userId: string): Promise<void> {
  await api.delete(memberUrl(boardId, userId));
}
