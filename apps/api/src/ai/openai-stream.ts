import { z } from 'zod';

import { LlmError } from './ai-errors.js';
import type { LlmEvent, LlmFinishReason, LlmToolCall, LlmUsage } from './llm-provider.js';

/**
 * Wire format of one streamed Chat Completions chunk. Only the fields used here are declared;
 * unknown fields (`system_fingerprint`, Ollama `timings`, Gemini extras, …) are stripped.
 */
const toolCallDeltaSchema = z.object({
  index: z.number().int().nonnegative().nullish(),
  id: z.string().nullish(),
  // Opaque provider data (Gemini: `{ google: { thought_signature } }`); kept only if an object.
  extra_content: z.unknown().optional(),
  function: z
    .object({
      name: z.string().nullish(),
      // Some servers send the complete arguments as an object instead of a JSON string.
      arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
    })
    .nullish(),
});

const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.number().nullish(),
        delta: z
          .object({
            content: z.string().nullish(),
            // Non-standard "thinking" tokens (Ollama: `reasoning`, others: `reasoning_content`).
            reasoning: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            tool_calls: z.array(toolCallDeltaSchema).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: z
    .object({ prompt_tokens: z.number().nullish(), completion_tokens: z.number().nullish() })
    .nullish(),
  error: z.unknown().optional(),
});

type ToolCallDelta = z.infer<typeof toolCallDeltaSchema>;

/** Signals about the raw stream that are not part of the answer (used for measurements). */
export type LlmStreamDiagnostic = { type: 'reasoning-delta' } | { type: 'tool-call-delta' };

export interface OpenAIStreamAssemblerOptions {
  /** Removed from any provider text that ends up in an error. */
  apiKey?: string | undefined;
  onDiagnostic?: ((diagnostic: LlmStreamDiagnostic) => void) | undefined;
}

interface ToolCallSlot {
  index: number | null;
  id: string;
  name: string;
  argumentsJson: string;
  extraContent: Record<string, unknown> | undefined;
  emitted: boolean;
}

const extraContentSchema = z.record(z.string(), z.unknown());

const MAX_PROVIDER_TEXT_LENGTH = 300;

/**
 * Removes credentials from text received from a provider (error bodies may quote a masked key,
 * e.g. OpenAI's "Incorrect API key provided: sk-…"), collapses whitespace and truncates it.
 */
export function sanitizeProviderText(text: string, apiKey?: string): string {
  let result = text;
  if (apiKey) result = result.split(apiKey).join('[REDACTED]');
  result = result
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|AIza)[\w*.-]+/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return result.length > MAX_PROVIDER_TEXT_LENGTH
    ? `${result.slice(0, MAX_PROVIDER_TEXT_LENGTH)}…`
    : result;
}

/** Reads the message of an error body: OpenAI/Ollama `{ error: { message } }`, Gemini `[{ error }]`. */
export function extractProviderErrorMessage(body: unknown): string | undefined {
  const candidate = Array.isArray(body) ? (body[0] as unknown) : body;
  if (typeof candidate === 'string') return candidate;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  if ('error' in candidate) {
    const { error } = candidate;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return typeof error.message === 'string' ? error.message : undefined;
    }
  }
  if ('message' in candidate && typeof candidate.message === 'string') return candidate.message;
  return undefined;
}

function mapFinishReason(raw: string): LlmFinishReason {
  switch (raw.toLowerCase()) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
    case 'max_tokens':
      return 'length';
    default:
      return 'other';
  }
}

/**
 * Turns the `data:` payloads of an OpenAI-compatible Chat Completions stream into `LlmEvent`s:
 * text deltas are passed through, tool call fragments are assembled by `index` (id, name and
 * argument pieces may arrive in separate chunks) and emitted complete, reasoning tokens are
 * counted but never emitted, usage is taken from whichever chunk reports it.
 */
export class OpenAIStreamAssembler {
  /** Number of chunks carrying `reasoning`/`reasoning_content` ("thinking") tokens. */
  reasoningChunks = 0;
  /** Whether the `[DONE]` sentinel was received. */
  sawDone = false;

  private readonly toolCalls: ToolCallSlot[] = [];
  private finishReason: LlmFinishReason | null = null;
  private usage: LlmUsage | null = null;
  private finished = false;

  private readonly onDiagnostic: OpenAIStreamAssemblerOptions['onDiagnostic'];
  /** A private field, so that serializing or logging the assembler never exposes the key. */
  readonly #apiKey: string | undefined;

  constructor({ apiKey, onDiagnostic }: OpenAIStreamAssemblerOptions = {}) {
    this.#apiKey = apiKey;
    this.onDiagnostic = onDiagnostic;
  }

  /** Processes the payload of one SSE message. */
  accept(data: string): LlmEvent[] {
    if (data.trim() === '[DONE]') {
      this.sawDone = true;
      return [];
    }
    const chunk = this.parseChunk(data);
    if (chunk.error !== undefined && chunk.error !== null) {
      const providerMessage = extractProviderErrorMessage(chunk);
      throw new LlmError(
        'LLM_BAD_RESPONSE',
        'The AI provider reported an error during the response',
        {
          ...(providerMessage !== undefined && {
            providerMessage: sanitizeProviderText(providerMessage, this.#apiKey),
          }),
        },
      );
    }

    if (chunk.usage) {
      this.usage = {
        promptTokens: chunk.usage.prompt_tokens ?? 0,
        completionTokens: chunk.usage.completion_tokens ?? 0,
      };
    }

    const events: LlmEvent[] = [];
    // A single completion is requested, so only the first choice matters.
    const choice = chunk.choices?.find((c) => (c.index ?? 0) === 0);
    if (!choice) return events;

    const delta = choice.delta;
    if (delta) {
      if (delta.reasoning || delta.reasoning_content) {
        this.reasoningChunks += 1;
        this.onDiagnostic?.({ type: 'reasoning-delta' });
      }
      if (delta.content) events.push({ type: 'text-delta', text: delta.content });
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        this.onDiagnostic?.({ type: 'tool-call-delta' });
        delta.tool_calls.forEach((toolCallDelta, position) => {
          this.addToolCallDelta(toolCallDelta, position);
        });
      }
    }

    if (choice.finish_reason) {
      this.finishReason = mapFinishReason(choice.finish_reason);
      events.push(...this.flushToolCalls());
    }
    return events;
  }

  /**
   * Ends the response (after `[DONE]` or when the stream simply closes): emits the tool calls not
   * emitted yet, the usage and `done`. Some servers report `stop` even with tool calls, so a
   * response containing tool calls always finishes with `tool_calls`.
   */
  finish(): LlmEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const events: LlmEvent[] = this.flushToolCalls();
    if (this.usage) events.push({ type: 'usage', ...this.usage });
    let finishReason = this.finishReason ?? 'other';
    if (this.toolCalls.length > 0 && (finishReason === 'stop' || this.finishReason === null)) {
      finishReason = 'tool_calls';
    }
    events.push({ type: 'done', finishReason });
    return events;
  }

  private parseChunk(data: string): z.infer<typeof chunkSchema> {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch (err) {
      throw new LlmError('LLM_BAD_RESPONSE', 'The AI provider sent a malformed response', {
        cause: err,
      });
    }
    const result = chunkSchema.safeParse(json);
    if (!result.success) {
      throw new LlmError('LLM_BAD_RESPONSE', 'The AI provider sent an unexpected response', {
        cause: result.error,
      });
    }
    return result.data;
  }

  private addToolCallDelta(delta: ToolCallDelta, position: number): void {
    const slot = this.findSlot(delta, position);
    if (delta.id) slot.id = delta.id;
    const extra = extraContentSchema.safeParse(delta.extra_content);
    // Assumes the provider sends `extra_content` whole in one fragment (Gemini does); a later
    // fragment only adds or replaces top-level keys.
    if (extra.success) slot.extraContent = { ...slot.extraContent, ...extra.data };
    const fn = delta.function;
    if (fn?.name) slot.name += fn.name;
    if (typeof fn?.arguments === 'string') slot.argumentsJson += fn.arguments;
    else if (fn?.arguments) slot.argumentsJson = JSON.stringify(fn.arguments);
  }

  private findSlot(delta: ToolCallDelta, position: number): ToolCallSlot {
    // Without an index (seen in some compatible servers), the call is matched by id, then by
    // its position in the delta array.
    const index = delta.index ?? null;
    let slot =
      index !== null
        ? this.toolCalls.findLast((s) => s.index === index)
        : delta.id
          ? this.toolCalls.find((s) => s.id === delta.id)
          : this.toolCalls[position];
    // A different id under an index already in use starts a new call (servers that number
    // every call 0).
    if (slot && delta.id && slot.id && slot.id !== delta.id) slot = undefined;
    if (!slot) {
      slot = {
        index,
        id: '',
        name: '',
        argumentsJson: '',
        extraContent: undefined,
        emitted: false,
      };
      this.toolCalls.push(slot);
    }
    return slot;
  }

  private flushToolCalls(): LlmEvent[] {
    const events: LlmEvent[] = [];
    this.toolCalls.forEach((slot, position) => {
      if (slot.emitted) return;
      if (slot.name === '') {
        throw new LlmError('LLM_BAD_RESPONSE', 'The AI provider sent a tool call without a name');
      }
      slot.emitted = true;
      const toolCall: LlmToolCall = {
        id: slot.id || `call_${String(position)}`,
        name: slot.name,
        argumentsJson: slot.argumentsJson.trim() === '' ? '{}' : slot.argumentsJson,
        ...(slot.extraContent && { extraContent: slot.extraContent }),
      };
      events.push({ type: 'tool-call', ...toolCall });
    });
    return events;
  }
}
