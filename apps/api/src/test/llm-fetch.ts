import { readFileSync } from 'node:fs';

import { mulberry32 } from '@streamline/shared';

/** Reads a recorded SSE stream from `src/ai/__fixtures__`. */
export function readSseFixture(name: string): Uint8Array {
  return readFileSync(new URL(`../ai/__fixtures__/${name}`, import.meta.url));
}

/** Splits bytes into pieces of 1..maxSize bytes at reproducible pseudo-random boundaries. */
export function splitAtRandom(bytes: Uint8Array, seed: number, maxSize = 24): Uint8Array[] {
  const random = mulberry32(seed);
  const pieces: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const size = 1 + Math.floor(random() * maxSize);
    pieces.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  return pieces;
}

/** Splits bytes into pieces ending right after each of the given offsets. */
export function splitAt(bytes: Uint8Array, offsets: number[]): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  let start = 0;
  for (const offset of [...offsets, bytes.length]) {
    if (offset > start) pieces.push(bytes.subarray(start, offset));
    start = Math.max(start, offset);
  }
  return pieces;
}

/** A response whose body yields the given pieces one by one. */
export function streamingResponse(pieces: Uint8Array[], init: ResponseInit = {}): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[index];
      index += 1;
      if (piece === undefined) controller.close();
      else controller.enqueue(piece);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    ...init,
  });
}

/** A response whose body sends the pieces and then stays open until the request is aborted. */
export function hangingResponse(
  pieces: Uint8Array[],
  signal: AbortSignal | null | undefined,
): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[index];
      index += 1;
      if (piece !== undefined) {
        controller.enqueue(piece);
        return;
      }
      return new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => {
          controller.error(signal.reason);
          resolve();
        });
      });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export interface RecordedFetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null | undefined;
}

export interface FetchStub {
  fetch: typeof fetch;
  calls: RecordedFetchCall[];
}

/** A `fetch` replacement recording the requests and answering with `respond`. */
export function createFetchStub(
  respond: (call: RecordedFetchCall) => Response | Promise<Response>,
): FetchStub {
  const calls: RecordedFetchCall[] = [];
  const fetchStub = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const call: RecordedFetchCall = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { fetch: fetchStub, calls };
}
