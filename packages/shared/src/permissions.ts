import type { BoardRole } from './schemas/board.js';

/**
 * Actions on a board guarded by the member's role. Used by the API to authorize requests and
 * by the web client to hide controls the user cannot use.
 */
export const BOARD_ACTIONS = [
  /** View the board, its columns, cards and analytics. */
  'board:view',
  'board:rename',
  'board:delete',
  'board:transfer',
  /** Add members, change their roles and remove them (never the owner, see `canManageMember`). */
  'members:manage',
  /** Create, rename, move and delete columns. */
  'column:write',
  /** Change column settings: WIP limit and category. */
  'column:settings',
  /** Create, edit and move cards, write comments. */
  'card:write',
  /** Use the AI assistant. */
  'ai:use',
] as const;

export type BoardAction = (typeof BOARD_ACTIONS)[number];

const EVERYONE: readonly BoardRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];
const CONTRIBUTORS: readonly BoardRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
const MANAGERS: readonly BoardRole[] = ['OWNER', 'ADMIN'];
const OWNER_ONLY: readonly BoardRole[] = ['OWNER'];

/** The permission matrix: roles allowed to perform each action. */
export const BOARD_PERMISSIONS: Readonly<Record<BoardAction, readonly BoardRole[]>> = {
  'board:view': EVERYONE,
  'board:rename': MANAGERS,
  'board:delete': OWNER_ONLY,
  'board:transfer': OWNER_ONLY,
  'members:manage': MANAGERS,
  'column:write': CONTRIBUTORS,
  'column:settings': MANAGERS,
  'card:write': CONTRIBUTORS,
  'ai:use': CONTRIBUTORS,
};

export function hasBoardPermission(role: BoardRole, action: BoardAction): boolean {
  return BOARD_PERMISSIONS[action].includes(role);
}

/**
 * Whether a member with `actorRole` may change the role of, or remove, a member with `targetRole`.
 * Managers may manage everyone except the owner (an ADMIN may manage other ADMINs).
 */
export function canManageMember(actorRole: BoardRole, targetRole: BoardRole): boolean {
  return hasBoardPermission(actorRole, 'members:manage') && targetRole !== 'OWNER';
}

/** Every member except the owner may leave a board (the board must never be left without one). */
export function canLeaveBoard(role: BoardRole): boolean {
  return role !== 'OWNER';
}

/** The member asking to change a comment. */
export interface CommentActor {
  userId: string;
  role: BoardRole;
}

/** The comment being changed; `authorId` is `null` when the author's account no longer exists. */
export interface CommentOwnership {
  authorId: string | null;
}

/** Only the author may edit a comment, and only while their role still allows writing cards. */
export function canEditComment(actor: CommentActor, comment: CommentOwnership): boolean {
  return comment.authorId === actor.userId && hasBoardPermission(actor.role, 'card:write');
}

/**
 * The author may delete their comment while their role allows writing cards; managers (OWNER,
 * ADMIN) may delete any comment of the board.
 */
export function canDeleteComment(actor: CommentActor, comment: CommentOwnership): boolean {
  return canEditComment(actor, comment) || MANAGERS.includes(actor.role);
}
