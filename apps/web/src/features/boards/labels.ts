import type { BoardRole, ColumnCategory } from '@streamline/shared';

export const ROLE_LABELS: Readonly<Record<BoardRole, string>> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export const CATEGORY_LABELS: Readonly<Record<ColumnCategory, string>> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};
