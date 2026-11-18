/**
 * Provider-neutral contract of the AI assistant's language model. Messages and tools follow the
 * OpenAI Chat Completions shape; adapters translate them to the wire format of their API.
 */

/** A complete tool call requested by the model (arguments are raw JSON, not yet validated). */
export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** A JSON Schema object (e.g. produced by `z.toJSONSchema`). */
export type JsonSchema = Record<string, unknown>;

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: JsonSchema;
}

/**
 * Values of the OpenAI-compatible `reasoning_effort` field ("thinking" of reasoning models);
 * `default` means the field is not sent, leaving the model's own default.
 */
export const LLM_REASONING_EFFORTS = [
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
] as const;
export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORTS)[number];

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  /** Aborts the call; the stream then fails with `LLM_ABORTED`. */
  signal?: AbortSignal;
  temperature?: number;
  /** Overrides the configured reasoning effort for this call (`default` omits the field). */
  reasoningEffort?: LlmReasoningEffort;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Events of one streamed model response, in this order: any number of `text-delta`, then the
 * assembled `tool-call`s, an optional `usage` (when the provider reports it) and exactly one `done`.
 */
export type LlmEvent =
  | { type: 'text-delta'; text: string }
  | ({ type: 'tool-call' } & LlmToolCall)
  | ({ type: 'usage' } & LlmUsage)
  | { type: 'done'; finishReason: LlmFinishReason };

export interface LlmProvider {
  /** Model identifier reported to clients (e.g. `qwen3.5:9b`). */
  readonly model: string;
  /**
   * Streams one model response. Fails with an `LlmError` (provider unavailable, timeout, HTTP
   * error, malformed stream or abort); never yields after `done`.
   */
  streamChat(request: LlmRequest): AsyncIterable<LlmEvent>;
}
