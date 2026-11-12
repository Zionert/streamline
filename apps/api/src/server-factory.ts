import { createServer, type Server as HttpServer } from 'node:http';

import type { Express } from 'express';

import { createApp, type AppDependencies } from './app.js';
import { createRealtime, type Realtime } from './realtime/index.js';

export interface StreamLineServer {
  httpServer: HttpServer;
  app: Express;
  realtime: Realtime;
}

/**
 * Creates the HTTP server serving both the REST API and Socket.io, with services publishing
 * their changes to the socket rooms. The server is not listening yet.
 */
export function createStreamLineServer(deps: AppDependencies): StreamLineServer {
  // The request listener must exist before Socket.io attaches: Socket.io takes over the existing
  // listeners and passes them only the requests outside its own path. The app itself needs the
  // event publisher of the socket server, so the listener delegates to it once it is built.
  let app: Express | null = null;
  const httpServer = createServer((req, res) => {
    if (!app) throw new Error('The HTTP server received a request before the app was built');
    app(req, res);
  });
  const realtime = createRealtime(httpServer, deps);
  app = createApp({ ...deps, events: realtime.events });
  return { httpServer, app, realtime };
}
