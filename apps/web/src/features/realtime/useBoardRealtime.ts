import {
  accessRevokedEventSchema,
  parseBoardEvent,
  presenceUpdateEventSchema,
  WS_ERROR_CODES,
  WS_EVENTS,
} from '@streamline/shared';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { BOARDS_PATH } from '@/features/boards/paths';
import { refreshSession } from '@/lib/api';
import { clearActiveSocket, createSocket, setActiveSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';

/** Toast id for losing access: several signals (event, join, reload) show one message. */
const ACCESS_TOAST_ID = 'board-access-lost';
const LIVE_UPDATES_TOAST_ID = 'live-updates-unavailable';

export const ACCESS_REVOKED_MESSAGE = 'You no longer have access to this board.';
export const BOARD_DELETED_MESSAGE = 'This board has been deleted.';
export const LIVE_UPDATES_UNAVAILABLE_MESSAGE =
  'Live updates are unavailable. Reload the page to try again.';

/** Pause before the single retry of a `board:join` that failed on the server. */
export const JOIN_RETRY_DELAY_MS = 1000;

/**
 * Handshake rejections answered by refreshing the session and connecting again. After this many
 * attempts in a row (e.g. the refreshed token is rejected too) the socket stays disconnected; a
 * refresh that fails ends the session as for REST requests.
 */
export const MAX_AUTH_RETRIES = 2;

function handshakeErrorCode(error: Error): string | undefined {
  if (!('data' in error) || typeof error.data !== 'object' || error.data === null) {
    return undefined;
  }
  return 'code' in error.data && typeof error.data.code === 'string' ? error.data.code : undefined;
}

/**
 * Live updates of the opened board: connects a socket (authenticated with the in-memory access
 * token), joins the board room and applies the changes made by others to the board store.
 *
 * - The socket disconnects when the page unmounts, the board changes or the user logs out.
 * - An expired or rejected token is refreshed through the API client and the socket reconnects.
 * - After every join of the room (the first one and each one after a reconnect) the whole board
 *   is reloaded, since events sent before the join are not delivered to this socket.
 * - The server disconnects the socket when its access token expires; the hook reconnects.
 * - Losing access (removed from the board, board deleted, or a reload answering 403/404) leaves
 *   the page for the board list with a toast.
 */
export function useBoardRealtime(boardId: string): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const navigate = useNavigate();
  // Read through a ref, so that a new `navigate` function never reconnects the socket.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    if (userId === null || boardId === '') {
      return;
    }
    const socket = createSocket();
    const store = () => useBoardStore.getState();
    let active = true;
    let authRetries = 0;
    let joinRetried = false;
    let joinRetryTimer: ReturnType<typeof setTimeout> | undefined;

    const loseAccess = (message: string) => {
      if (!active) {
        return;
      }
      active = false;
      socket.disconnect();
      store().forgetBoard(boardId);
      toast.info(message, { id: ACCESS_TOAST_ID });
      void navigateRef.current(BOARDS_PATH, { replace: true });
    };

    /**
     * Joins the board room. Once the server has confirmed the join, every later change reaches
     * this socket, so the board is (re)loaded only then: changes made before the join are in
     * that snapshot, changes made after it arrive as events. This also covers the gap between
     * opening the page and the first join, and everything missed while disconnected.
     */
    const joinRoom = () => {
      socket.emit('board:join', { boardId }, (ack) => {
        if (!active) {
          return;
        }
        if (ack.ok) {
          joinRetried = false;
          store().setPresence(boardId, ack.presence);
          void store()
            .resyncBoard(boardId)
            .then((result) => {
              if (result === 'access-lost') {
                loseAccess(ACCESS_REVOKED_MESSAGE);
              }
            });
        } else if (ack.error.code === WS_ERROR_CODES.NOT_FOUND) {
          loseAccess(ACCESS_REVOKED_MESSAGE);
        } else if (!joinRetried) {
          joinRetried = true;
          joinRetryTimer = setTimeout(() => {
            if (active && socket.connected) {
              joinRoom();
            }
          }, JOIN_RETRY_DELAY_MS);
        } else {
          toast.error(LIVE_UPDATES_UNAVAILABLE_MESSAGE, { id: LIVE_UPDATES_TOAST_ID });
        }
      });
    };

    socket.on('connect', () => {
      if (!active) {
        return;
      }
      authRetries = 0;
      joinRoom();
    });

    socket.on('disconnect', (reason) => {
      // The server ends the connection when the access token expires. Socket.io does not
      // reconnect on its own then; connecting again sends the current token, and an expired one
      // is refreshed through `connect_error`.
      if (active && reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.on('connect_error', (error) => {
      const code = handshakeErrorCode(error);
      // Transport errors are retried by Socket.io itself; a rejected handshake is not.
      if (code !== WS_ERROR_CODES.TOKEN_EXPIRED && code !== WS_ERROR_CODES.UNAUTHORIZED) {
        return;
      }
      if (!active || authRetries >= MAX_AUTH_RETRIES) {
        return;
      }
      authRetries += 1;
      refreshSession().then(
        () => {
          if (active) {
            socket.connect();
          }
        },
        () => {
          // A rejected refresh has cleared the session (the app returns to the login page).
        },
      );
    });

    socket.onAny((name: string, payload: unknown) => {
      if (!active) {
        return;
      }
      const event = parseBoardEvent(name, payload);
      if (!event || event.payload.boardId !== boardId) {
        return;
      }
      if (event.name === WS_EVENTS.BOARD_DELETED) {
        loseAccess(BOARD_DELETED_MESSAGE);
      } else {
        store().applyBoardEvent(event);
      }
    });

    socket.on(WS_EVENTS.BOARD_ACCESS_REVOKED, (payload) => {
      const parsed = accessRevokedEventSchema.safeParse(payload);
      if (parsed.success && parsed.data.boardId === boardId) {
        loseAccess(ACCESS_REVOKED_MESSAGE);
      }
    });

    socket.on(WS_EVENTS.PRESENCE_UPDATE, (payload) => {
      const parsed = presenceUpdateEventSchema.safeParse(payload);
      if (active && parsed.success && parsed.data.boardId === boardId) {
        store().setPresence(boardId, parsed.data.users);
      }
    });

    setActiveSocket(socket);
    socket.connect();

    return () => {
      const wasActive = active;
      active = false;
      clearTimeout(joinRetryTimer);
      clearActiveSocket(socket);
      if (wasActive && socket.connected) {
        socket.emit('board:leave', { boardId }, () => undefined);
      }
      socket.removeAllListeners();
      socket.offAny();
      socket.disconnect();
      store().setPresence(boardId, []);
    };
  }, [boardId, userId]);
}
