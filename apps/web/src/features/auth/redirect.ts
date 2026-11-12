import { BOARDS_PATH } from '@/features/boards/paths';

/** Router state set by `ProtectedRoute` when it sends a guest to the login page. */
export interface AuthRedirectState {
  from: { pathname: string; search?: string; hash?: string };
}

/** Landing page of a logged-in user. */
export const HOME_PATH = BOARDS_PATH;
export const LOGIN_PATH = '/login';
export const REGISTER_PATH = '/register';

const GUEST_PATHS = new Set([LOGIN_PATH, REGISTER_PATH]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Where to go after a successful login: the originally requested location if the router state
 * carries a valid in-app path, otherwise home.
 */
export function getRedirectTarget(state: unknown): string {
  if (!isRecord(state) || !isRecord(state.from)) {
    return HOME_PATH;
  }
  const { pathname, search, hash } = state.from;
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.startsWith('/\\') ||
    GUEST_PATHS.has(pathname)
  ) {
    return HOME_PATH;
  }
  return `${pathname}${typeof search === 'string' ? search : ''}${typeof hash === 'string' ? hash : ''}`;
}
