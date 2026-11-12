import type { Server as HttpServer } from 'node:http';

import {
  boardRoom,
  boardRoomRequestSchema,
  userRoom,
  WS_ERROR_CODES,
  WS_EVENTS,
  type BoardJoinAck,
  type BoardLeaveAck,
  type ClientToServerEvents,
  type PresenceUser,
  type ServerToClientEvents,
  type WsErrorCode,
} from '@streamline/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';

import type { AppConfig } from '../config/env.js';
import { AccessTokenExpiredError, AppError, UnauthorizedError } from '../errors/app-error.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { BoardAccessService } from '../services/board-access.service.js';
import type { TokenService } from '../services/token.service.js';
import type { BoardEvents, ChangeOrigin } from './board-events.js';
import { createPresenceTracker, type PresenceTracker } from './presence.js';

/** Data attached to an authenticated socket by the handshake middleware. */
export interface SocketData {
  userId: string;
  user: PresenceUser;
  /** When the access token of the handshake expires (ms since the epoch). */
  tokenExpiresAt: number;
}

type InterServerEvents = Record<string, never>;

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface RealtimeDependencies {
  config: Pick<AppConfig, 'CORS_ORIGIN'>;
  logger: Logger;
  tokens: Pick<TokenService, 'verifyAccessTokenClaims'>;
  boardAccess: Pick<BoardAccessService, 'require'>;
  users: Pick<UserRepository, 'findById'>;
  presence?: PresenceTracker;
}

export interface Realtime {
  io: RealtimeServer;
  /** Publisher for services: broadcasts committed changes to the board rooms. */
  events: BoardEvents;
  presence: PresenceTracker;
  /** Disconnects all sockets and closes the server (including the underlying HTTP server). */
  close(): Promise<void>;
}

/** `setTimeout` cannot wait longer than this (about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647;

/** An error passed to `next()` in the handshake; the client gets it as `connect_error`. */
function handshakeError(code: WsErrorCode, message: string): Error & { data: { code: string } } {
  return Object.assign(new Error(message), { data: { code } });
}

const BOARD_NOT_FOUND = { code: WS_ERROR_CODES.NOT_FOUND, message: 'Board not found' };

/** The socket disconnected while its request was being handled (nobody reads the reply). */
const GONE: BoardJoinAck = {
  ok: false,
  error: { code: WS_ERROR_CODES.INTERNAL_ERROR, message: 'Socket disconnected' },
};

/**
 * Attaches the Socket.io server to the HTTP server.
 *
 * - Handshake: the access token in `auth.token` is verified like a REST Bearer token; failures
 *   are reported with `err.data.code` = `UNAUTHORIZED` or `TOKEN_EXPIRED` (refresh and reconnect).
 * - Every socket joins its user's room (`user:<id>`), so all sockets of a user can be reached,
 *   e.g. to force them out of a board they lost access to.
 * - `board:join` checks `board:view` and puts the socket in `board:<id>`; `board:leave` takes it
 *   out. Clients never change data through the socket: they only receive broadcasts.
 * - Presence: users with at least one socket in a board room; changes are sent as
 *   `presence:update` to the room.
 */
export function attachRealtime(httpServer: HttpServer, deps: RealtimeDependencies): Realtime {
  const { config, tokens, boardAccess, users } = deps;
  const logger = deps.logger.child({ module: 'realtime' });
  const presence = deps.presence ?? createPresenceTracker();

  const io: RealtimeServer = new Server(httpServer, {
    cors: { origin: config.CORS_ORIGIN, credentials: true },
    serveClient: false,
  });

  function broadcastPresence(boardId: string): void {
    io.to(boardRoom(boardId)).emit(WS_EVENTS.PRESENCE_UPDATE, {
      boardId,
      users: presence.list(boardId),
    });
  }

  /** The socket to skip for an event: only a connected socket of the user who made the change. */
  function originSocketId(origin: ChangeOrigin | undefined, actorId: string): string | null {
    const socketId = origin?.socketId;
    if (socketId === undefined) return null;
    return io.sockets.sockets.get(socketId)?.data.userId === actorId ? socketId : null;
  }

  const events: BoardEvents = {
    publish(name, payload, origin) {
      const room = io.to(boardRoom(payload.boardId));
      const skip = originSocketId(origin, payload.actorId);
      // Socket.io's typings cannot relate a generic event name to its payload; the signature of
      // `publish` already guarantees that they match.
      const target = (skip === null ? room : room.except(skip)) as unknown as {
        emit(event: string, eventPayload: unknown): boolean;
      };
      target.emit(name, payload);
      logger.debug({ event: name, boardId: payload.boardId, actorId: payload.actorId }, 'Event');
    },

    revokeAccess(boardId, userId, origin) {
      io.in(userRoom(userId)).socketsLeave(boardRoom(boardId));
      const sockets = io.to(userRoom(userId));
      const skip = originSocketId(origin, userId);
      (skip === null ? sockets : sockets.except(skip)).emit(WS_EVENTS.BOARD_ACCESS_REVOKED, {
        boardId,
      });
      if (presence.removeUser(boardId, userId)) {
        broadcastPresence(boardId);
      }
      logger.debug({ boardId, userId }, 'Board access revoked');
    },

    closeBoard(payload, origin) {
      events.publish(WS_EVENTS.BOARD_DELETED, payload, origin);
      io.in(boardRoom(payload.boardId)).socketsLeave(boardRoom(payload.boardId));
      presence.clearBoard(payload.boardId);
    },
  };

  /** Verifies the handshake token and attaches the user; throws a handshake error otherwise. */
  async function authenticate(socket: RealtimeSocket): Promise<void> {
    const auth: unknown = socket.handshake.auth;
    const token =
      typeof auth === 'object' && auth !== null && 'token' in auth ? auth.token : undefined;
    if (typeof token !== 'string' || token.length === 0) {
      throw handshakeError(WS_ERROR_CODES.UNAUTHORIZED, 'Missing access token');
    }
    try {
      const { userId, expiresAt } = await tokens.verifyAccessTokenClaims(token);
      const user = await users.findById(userId);
      if (!user) throw new UnauthorizedError('User no longer exists');
      socket.data.userId = userId;
      socket.data.user = { id: user.id, name: user.name };
      socket.data.tokenExpiresAt = expiresAt;
    } catch (err) {
      if (err instanceof AccessTokenExpiredError) {
        throw handshakeError(WS_ERROR_CODES.TOKEN_EXPIRED, 'Access token expired');
      }
      if (err instanceof UnauthorizedError) {
        logger.warn(
          { socketId: socket.id, address: socket.handshake.address },
          'Socket handshake rejected: invalid access token',
        );
        throw handshakeError(WS_ERROR_CODES.UNAUTHORIZED, 'Invalid access token');
      }
      logger.error({ err }, 'Socket handshake failed');
      throw handshakeError(WS_ERROR_CODES.INTERNAL_ERROR, 'Internal server error');
    }
  }

  io.use((socket, next) => {
    authenticate(socket).then(
      () => next(),
      (err: Error) => next(err),
    );
  });

  async function joinBoard(socket: RealtimeSocket, payload: unknown): Promise<BoardJoinAck> {
    const parsed = boardRoomRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: { code: WS_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid' } };
    }
    const { boardId } = parsed.data;
    const { userId, user } = socket.data;
    const room = boardRoom(boardId);

    await boardAccess.require(boardId, userId, 'board:view');
    if (!socket.connected) return GONE;
    await socket.join(room);
    // A removal committed between the check and the join did not find this socket in the room.
    try {
      await boardAccess.require(boardId, userId, 'board:view');
    } catch (err) {
      await socket.leave(room);
      throw err;
    }
    if (!socket.connected) {
      await socket.leave(room);
      return GONE;
    }
    if (presence.join(boardId, socket.id, user)) {
      broadcastPresence(boardId);
    }
    logger.debug({ boardId, userId, socketId: socket.id }, 'Joined board');
    return { ok: true, presence: presence.list(boardId) };
  }

  async function leaveBoard(socket: RealtimeSocket, payload: unknown): Promise<BoardLeaveAck> {
    const parsed = boardRoomRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: { code: WS_ERROR_CODES.VALIDATION_ERROR, message: 'Invalid' } };
    }
    const { boardId } = parsed.data;
    await socket.leave(boardRoom(boardId));
    if (presence.leave(boardId, socket.id)) {
      broadcastPresence(boardId);
    }
    return { ok: true };
  }

  /** Maps a failure of a room request to an acknowledgement; non-members get `NOT_FOUND`. */
  function failure(err: unknown): { ok: false; error: { code: string; message: string } } {
    if (err instanceof AppError && (err.statusCode === 404 || err.statusCode === 403)) {
      return { ok: false, error: BOARD_NOT_FOUND };
    }
    logger.error({ err }, 'Socket request failed');
    return {
      ok: false,
      error: { code: WS_ERROR_CODES.INTERNAL_ERROR, message: 'Internal server error' },
    };
  }

  io.on('connection', (socket) => {
    const { userId, tokenExpiresAt } = socket.data;
    void socket.join(userRoom(userId));
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');

    // The access token authorizes the connection only until it expires: then the socket is
    // disconnected and the client reconnects with a fresh token (refreshing its session).
    const expiryTimer = setTimeout(
      () => {
        logger.debug({ userId, socketId: socket.id }, 'Access token expired; disconnecting');
        socket.disconnect(true);
      },
      Math.min(Math.max(tokenExpiresAt - Date.now(), 0), MAX_TIMER_MS),
    );

    socket.on('board:join', (payload, ack) => {
      if (typeof ack !== 'function') return;
      joinBoard(socket, payload).then(ack, (err: unknown) => ack(failure(err)));
    });

    socket.on('board:leave', (payload, ack) => {
      if (typeof ack !== 'function') return;
      leaveBoard(socket, payload).then(ack, (err: unknown) => ack(failure(err)));
    });

    socket.on('disconnect', (reason) => {
      clearTimeout(expiryTimer);
      for (const boardId of presence.leaveAll(socket.id)) {
        broadcastPresence(boardId);
      }
      logger.debug({ userId, socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  return {
    io,
    events,
    presence,
    close: () => io.close(),
  };
}
