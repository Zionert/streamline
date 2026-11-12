import type { ClientToServerEvents, ServerToClientEvents } from '@streamline/shared';
import { io, type Socket } from 'socket.io-client';

import { useAuthStore } from '@/stores/auth';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Socket.io endpoint, served under `/api` like the REST API (the dev server proxies both). */
export const SOCKET_PATH = '/api/socket.io';

export type SocketFactory = () => AppSocket;

/**
 * A socket that is not connected yet. The access token is read on every (re)connection attempt,
 * so a reconnect after a session refresh uses the new token.
 */
const defaultFactory: SocketFactory = () =>
  io({
    path: SOCKET_PATH,
    autoConnect: false,
    auth: (callback) => {
      callback({ token: useAuthStore.getState().accessToken ?? '' });
    },
  });

let factory: SocketFactory = defaultFactory;
let activeSocket: AppSocket | null = null;

export function createSocket(): AppSocket {
  return factory();
}

/** Replaces the socket factory (tests); `null` restores the default. */
export function setSocketFactory(next: SocketFactory | null): void {
  factory = next ?? defaultFactory;
}

/** Registers the socket of the opened board, whose id is sent with REST changes. */
export function setActiveSocket(socket: AppSocket | null): void {
  activeSocket = socket;
}

/** Unregisters the socket unless another one has replaced it meanwhile. */
export function clearActiveSocket(socket: AppSocket): void {
  if (activeSocket === socket) {
    activeSocket = null;
  }
}

/** Id of the connected socket of the opened board, or `null`. */
export function getActiveSocketId(): string | null {
  return activeSocket?.connected ? (activeSocket.id ?? null) : null;
}
