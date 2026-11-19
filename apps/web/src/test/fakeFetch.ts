import { vi } from 'vitest';

/** One call of the stubbed `fetch`. */
export interface FetchCall {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null;
}

export type FetchResponder = (call: FetchCall) => Response | Promise<Response> | 'network-error';

/**
 * Replaces the global `fetch` (undone after each test by `vi.unstubAllGlobals()` in the setup).
 * Responders are used in order; the last one stays in place for further calls.
 */
export function installFakeFetch() {
  const calls: FetchCall[] = [];
  let responders: FetchResponder[] = [];

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: FetchCall = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body,
      signal: init.signal ?? null,
    };
    calls.push(call);
    if (call.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const responder = responders.length > 1 ? responders.shift() : responders[0];
    if (!responder) {
      throw new Error(`No fake response for ${call.method} ${url}`);
    }
    const response = await responder(call);
    if (response === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchStub);

  return {
    calls,
    respond(...next: FetchResponder[]) {
      responders = next;
    },
  };
}

export type FakeFetch = ReturnType<typeof installFakeFetch>;

/** A JSON response (e.g. an error before the stream starts). */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Text of one Server-Sent Event. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A complete event stream answering at once with the given text chunks. */
export function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

/**
 * An event stream driven by the test: `respond` opens it for a call (aborting the call's signal
 * fails the stream like a real `fetch`), `send` and `push` add to it, `close` ends it.
 */
export function controlledStream() {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let isClosed = false;

  return {
    respond(call: FetchCall): Response {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      call.signal?.addEventListener('abort', () => {
        if (!isClosed) {
          isClosed = true;
          streamController?.error(new DOMException('The operation was aborted.', 'AbortError'));
        }
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      });
    },
    push(text: string) {
      streamController?.enqueue(encoder.encode(text));
    },
    send(event: string, data: unknown) {
      streamController?.enqueue(encoder.encode(sseEvent(event, data)));
    },
    /** Drops the connection mid-stream. */
    fail() {
      isClosed = true;
      streamController?.error(new TypeError('network error'));
    },
    close() {
      if (!isClosed) {
        isClosed = true;
        streamController?.close();
      }
    },
    get isOpen() {
      return streamController !== null && !isClosed;
    },
  };
}
