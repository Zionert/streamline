import { SOCKET_ID_HEADER } from '@streamline/shared';
import type { Request } from 'express';

import type { ChangeOrigin } from '../realtime/board-events.js';

/** Socket.io ids are short URL-safe strings; anything else is ignored. */
const SOCKET_ID_PATTERN = /^[\w-]{1,64}$/;

/** The origin of a REST change: the client's socket id from the `X-Socket-Id` header, if valid. */
export function changeOrigin(req: Request): ChangeOrigin {
  const socketId = req.get(SOCKET_ID_HEADER);
  return socketId !== undefined && SOCKET_ID_PATTERN.test(socketId) ? { socketId } : {};
}
