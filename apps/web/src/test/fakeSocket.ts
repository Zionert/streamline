import type { BoardJoinAck, BoardLeaveAck } from '@streamline/shared';

import type { AppSocket } from '@/lib/socket';

type Listener = (...args: unknown[]) => void;

export interface EmittedRequest {
  event: string;
  payload: unknown;
}

/**
 * How the fake server answers `board:join` (default: joined, nobody else present); `null` holds
 * the acknowledgement until `ackJoin()`.
 */
export type JoinResponder = (payload: unknown) => BoardJoinAck | null;

let socketCounter = 0;

/**
 * In-memory stand-in for a Socket.io client socket. Tests drive the "server" side with
 * `serverConnect()`, `serverEmit()` and `failConnect()`; requests sent by the app are recorded.
 */
export class FakeSocket {
  id: string | undefined = undefined;
  connected = false;
  /** Number of `connect()` calls made by the app. */
  connectCalls = 0;
  disconnected = false;
  readonly emitted: EmittedRequest[] = [];
  joinResponder: JoinResponder = () => ({ ok: true, presence: [] });
  private readonly heldJoinAcks: ((response: unknown) => void)[] = [];

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly anyListeners = new Set<Listener>();

  on(event: string, listener: Listener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener?: Listener): this {
    if (listener) {
      this.listeners.get(event)?.delete(listener);
    } else {
      this.listeners.delete(event);
    }
    return this;
  }

  onAny(listener: Listener): this {
    this.anyListeners.add(listener);
    return this;
  }

  offAny(listener?: Listener): this {
    if (listener) {
      this.anyListeners.delete(listener);
    } else {
      this.anyListeners.clear();
    }
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    this.anyListeners.clear();
    return this;
  }

  emit(event: string, payload: unknown, ack?: (response: unknown) => void): this {
    this.emitted.push({ event, payload });
    if (event === 'board:join') {
      const response = this.joinResponder(payload);
      if (response) {
        queueMicrotask(() => ack?.(response));
      } else if (ack) {
        this.heldJoinAcks.push(ack);
      }
    } else if (event === 'board:leave') {
      const response: BoardLeaveAck = { ok: true };
      queueMicrotask(() => ack?.(response));
    }
    return this;
  }

  connect(): this {
    this.connectCalls += 1;
    this.disconnected = false;
    return this;
  }

  disconnect(): this {
    this.disconnected = true;
    this.connected = false;
    this.id = undefined;
    return this;
  }

  // --- Server side, driven by tests ---

  /** Completes a (re)connection; fires `connect` like Socket.io does on every reconnect. */
  serverConnect(): void {
    socketCounter += 1;
    this.id = `socket-${socketCounter}`;
    this.connected = true;
    this.fire('connect');
  }

  /** Answers the oldest held `board:join`. */
  ackJoin(response: BoardJoinAck): void {
    const ack = this.heldJoinAcks.shift();
    if (!ack) throw new Error('No board:join is waiting for an acknowledgement');
    ack(response);
  }

  /**
   * Drops the connection. With `transport close` Socket.io reconnects on its own; with
   * `io server disconnect` (e.g. the access token expired) it does not.
   */
  serverDisconnect(reason = 'transport close'): void {
    this.connected = false;
    this.id = undefined;
    this.fire('disconnect', reason);
  }

  /** Rejects the handshake with an error code, as the server's auth middleware does. */
  failConnect(code: string): void {
    this.connected = false;
    this.fire('connect_error', Object.assign(new Error(code), { data: { code } }));
  }

  /** Delivers a server event to the app's listeners. */
  serverEmit(event: string, payload: unknown): void {
    for (const listener of this.anyListeners) listener(event, payload);
    this.fire(event, payload);
  }

  requests(event: string): unknown[] {
    return this.emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  asSocket(): AppSocket {
    // Implements the part of the Socket.io client API the app uses.
    return this as unknown as AppSocket;
  }
}
