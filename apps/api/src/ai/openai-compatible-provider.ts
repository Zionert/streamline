import { LlmError } from './ai-errors.js';
import type {
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmReasoningEffort,
  LlmRequest,
  LlmToolDefinition,
} from './llm-provider.js';
import {
  OpenAIStreamAssembler,
  extractProviderErrorMessage,
  sanitizeProviderText,
  type LlmStreamDiagnostic,
} from './openai-stream.js';
import { SseParser } from './sse-parser.js';

export interface OpenAICompatibleProviderOptions {
  /** Base URL of the API, e.g. `http://localhost:11434/v1` (a trailing slash is allowed). */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer` when set. */
  apiKey?: string | undefined;
  /** Upper bound of the whole call. */
  timeoutMs: number;
  /** Max wait for the response headers and then between two received chunks. */
  idleTimeoutMs: number;
  /**
   * `reasoning_effort` of every call unless the request overrides it; `default` (or unset)
   * omits the field.
   */
  reasoningEffort?: LlmReasoningEffort | undefined;
  /** Replaces the global `fetch` (tests). */
  fetch?: typeof fetch;
  /** Receives signals about the raw stream (e.g. reasoning tokens) for measurements. */
  onDiagnostic?: (diagnostic: LlmStreamDiagnostic) => void;
}

/** Bytes of an HTTP error body read for its message; the rest is discarded. */
const MAX_ERROR_BODY_BYTES = 4096;

type AbortCause = 'caller' | 'timeout' | 'idle';

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function toWireMessage(message: LlmMessage): WireMessage {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: message.content };
    case 'assistant': {
      const toolCalls = message.toolCalls ?? [];
      if (toolCalls.length === 0) return { role: 'assistant', content: message.content ?? '' };
      // With tool calls, empty text is sent as `null` (some servers reject an empty text part).
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      };
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

function toWireTool(tool: LlmToolDefinition) {
  return {
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

/** `{baseUrl}/chat/completions`, with or without a trailing slash in the base URL. */
export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

async function readCappedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

/**
 * The model provider of the AI assistant: any API compatible with OpenAI Chat Completions
 * (Ollama, OpenAI, Gemini, …), called with the global `fetch` and a streamed (SSE) response.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly model: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly options: Omit<OpenAICompatibleProviderOptions, 'apiKey'>;
  /** A private field, so that serializing or logging the provider never exposes the key. */
  readonly #apiKey: string | undefined;

  constructor({ apiKey, ...options }: OpenAICompatibleProviderOptions) {
    this.#apiKey = apiKey;
    this.options = options;
    this.model = options.model;
    this.url = chatCompletionsUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * Timeouts: `timeoutMs` bounds the whole call, including the time the consumer holds an
   * event (the generator is suspended at a `yield`). `idleTimeoutMs` counts only the waiting for
   * the provider: it is paused while an event is held and restarts when reading resumes.
   */
  streamChat(request: LlmRequest): AsyncIterable<LlmEvent> {
    return this.run(request);
  }

  private buildBody(request: LlmRequest): string {
    const tools = request.tools ?? [];
    const reasoningEffort = request.reasoningEffort ?? this.options.reasoningEffort ?? 'default';
    return JSON.stringify({
      model: this.model,
      messages: request.messages.map(toWireMessage),
      stream: true,
      // Ignored by servers that do not report usage in streams.
      stream_options: { include_usage: true },
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(reasoningEffort !== 'default' && { reasoning_effort: reasoningEffort }),
      ...(tools.length > 0 && { tools: tools.map(toWireTool), tool_choice: 'auto' }),
    });
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(this.#apiKey && { Authorization: `Bearer ${this.#apiKey}` }),
    };
  }

  private async *run(request: LlmRequest): AsyncGenerator<LlmEvent, void, undefined> {
    const callerSignal = request.signal;
    if (callerSignal?.aborted) throw abortError('caller');

    // One controller aborts the request for every reason; `state.cause` remembers which one.
    const controller = new AbortController();
    const state: { cause: AbortCause | null } = { cause: null };
    const abort = (cause: AbortCause) => {
      if (controller.signal.aborted) return;
      state.cause = cause;
      controller.abort();
    };
    const onCallerAbort = () => abort('caller');
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    const overallTimer = setTimeout(() => abort('timeout'), this.options.timeoutMs);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort('idle'), this.options.idleTimeoutMs);
    };

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // A pending read does not always settle on abort (e.g. a stubbed body), so cancel it.
    const cancelReader = () => void reader?.cancel().catch(() => undefined);
    controller.signal.addEventListener('abort', cancelReader, { once: true });

    const failure = (err: unknown): LlmError => {
      if (state.cause !== null) return abortError(state.cause, this.options);
      if (err instanceof LlmError) return err;
      // The host and the network error are for logs only; the message may reach users.
      return new LlmError('LLM_UNAVAILABLE', 'The AI provider is unavailable.', {
        providerMessage: sanitizeProviderText(
          `Could not reach ${new URL(this.url).host}: ${describeNetworkError(err)}`,
          this.#apiKey,
        ),
        cause: err,
      });
    };

    let completed = false;
    try {
      resetIdleTimer();
      let response: Response;
      try {
        response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: this.buildBody(request),
          signal: controller.signal,
        });
      } catch (err) {
        throw failure(err);
      }
      if (state.cause !== null) throw failure(null);

      if (!response.ok) throw await this.httpError(response, controller.signal, failure);
      if (!response.body) {
        throw new LlmError('LLM_BAD_RESPONSE', 'The AI provider sent an empty response');
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const parser = new SseParser();
      const assembler = new OpenAIStreamAssembler({
        apiKey: this.#apiKey,
        onDiagnostic: this.options.onDiagnostic,
      });

      resetIdleTimer();
      while (!assembler.sawDone) {
        let result: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;
        try {
          result = await reader.read();
        } catch (err) {
          throw failure(err);
        }
        if (state.cause !== null) throw failure(null);
        resetIdleTimer();
        const messages = result.done
          ? [...parser.push(decoder.decode()), ...parser.end()]
          : parser.push(decoder.decode(result.value, { stream: true }));
        for (const message of messages) {
          for (const event of assembler.accept(message.data)) {
            // The idle timeout measures the provider, not a consumer holding the event; the
            // overall timeout keeps running.
            clearTimeout(idleTimer);
            yield event;
            resetIdleTimer();
          }
          if (assembler.sawDone) break;
        }
        // A stream closed without `[DONE]` still ends normally with what was received.
        if (result.done) break;
      }
      clearTimeout(idleTimer);
      yield* assembler.finish();
      completed = true;
    } finally {
      clearTimeout(overallTimer);
      clearTimeout(idleTimer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
      controller.signal.removeEventListener('abort', cancelReader);
      // Releases the connection after `[DONE]`, an error or a consumer that stopped early,
      // without relying on the fetch implementation to end the body on abort.
      cancelReader();
      if (!completed) controller.abort();
    }
  }

  private async httpError(
    response: Response,
    signal: AbortSignal,
    failure: (err: unknown) => LlmError,
  ): Promise<LlmError> {
    let text = '';
    if (response.body) {
      try {
        text = await readCappedText(response.body, MAX_ERROR_BODY_BYTES, signal);
      } catch (err) {
        return failure(err);
      }
    }
    if (signal.aborted) return failure(null);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON: the raw text is the message.
    }
    const raw = extractProviderErrorMessage(parsed) ?? text;
    const providerMessage = sanitizeProviderText(raw, this.#apiKey);
    return new LlmError(
      'LLM_HTTP_ERROR',
      `The AI provider responded with HTTP ${String(response.status)}`,
      {
        providerStatus: response.status,
        ...(providerMessage !== '' && { providerMessage }),
      },
    );
  }
}

/** E.g. `fetch failed (ECONNREFUSED)` from Node's fetch error and its cause. */
function describeNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return 'network error';
  const cause: unknown = err.cause;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? ` (${cause.code})`
      : '';
  return `${err.message}${code}`;
}

function abortError(
  cause: AbortCause,
  options?: Pick<OpenAICompatibleProviderOptions, 'timeoutMs' | 'idleTimeoutMs'>,
): LlmError {
  switch (cause) {
    case 'caller':
      return new LlmError('LLM_ABORTED', 'The AI request was cancelled');
    case 'timeout':
      return new LlmError(
        'LLM_TIMEOUT',
        `The AI provider did not finish within ${String(options?.timeoutMs)} ms`,
      );
    case 'idle':
      return new LlmError(
        'LLM_TIMEOUT',
        `The AI provider sent no data for ${String(options?.idleTimeoutMs)} ms`,
      );
  }
}
