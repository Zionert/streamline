import type { z } from 'zod';

import { AiValidationError, LlmError, type AiValidationIssue } from './ai-errors.js';
import type {
  LlmEvent,
  LlmFinishReason,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmToolCall,
  LlmUsage,
} from './llm-provider.js';

/** A whole model response gathered from its events. */
export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  usage: LlmUsage | null;
  finishReason: LlmFinishReason;
}

/** Consumes a response stream, optionally passing every event on (e.g. to stream text). */
export async function collectResponse(
  events: AsyncIterable<LlmEvent>,
  onEvent?: (event: LlmEvent) => void,
): Promise<LlmResponse> {
  const response: LlmResponse = { text: '', toolCalls: [], usage: null, finishReason: 'other' };
  for await (const event of events) {
    onEvent?.(event);
    switch (event.type) {
      case 'text-delta':
        response.text += event.text;
        break;
      case 'tool-call':
        response.toolCalls.push({
          id: event.id,
          name: event.name,
          argumentsJson: event.argumentsJson,
        });
        break;
      case 'usage':
        response.usage = addUsage(response.usage, event);
        break;
      case 'done':
        response.finishReason = event.finishReason;
        break;
    }
  }
  return response;
}

function addUsage(total: LlmUsage | null, usage: LlmUsage | null): LlmUsage | null {
  if (!usage) return total;
  return {
    promptTokens: (total?.promptTokens ?? 0) + usage.promptTokens,
    completionTokens: (total?.completionTokens ?? 0) + usage.completionTokens,
  };
}

/**
 * The raw JSON to validate, picked from a response: the arguments of a tool call (then the
 * correction is sent as that call's tool result) or text. `missing` describes the output the
 * model failed to produce.
 */
export type ValidationCandidate = { json: string; toolCall?: LlmToolCall } | { missing: string };

/** Picks the arguments of the first call to `toolName`. */
export function toolCallArguments(toolName: string) {
  return (response: LlmResponse): ValidationCandidate => {
    const toolCall = response.toolCalls.find((call) => call.name === toolName);
    return toolCall
      ? { json: toolCall.argumentsJson, toolCall }
      : { missing: `Call the tool "${toolName}".` };
  };
}

/** Picks a JSON answer given as text (a surrounding Markdown code fence is removed). */
export function jsonText(response: LlmResponse): ValidationCandidate {
  const text = response.text.trim();
  if (text === '') return { missing: 'Respond with the JSON output.' };
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  return { json: fenced?.[1] ?? text };
}

export interface RunWithValidationOptions<T> {
  provider: LlmProvider;
  request: LlmRequest;
  schema: z.ZodType<T>;
  extract: (response: LlmResponse) => ValidationCandidate;
  /** Receives the events of every attempt (numbered from 1). */
  onEvent?: (event: LlmEvent, attempt: number) => void;
}

export interface ValidatedOutput<T> {
  value: T;
  attempts: 1 | 2;
  /** The response that passed validation. */
  response: LlmResponse;
  /** Tokens of all attempts, when the provider reported them. */
  usage: LlmUsage | null;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: AiValidationIssue[] };

const MAX_FEEDBACK_ISSUES = 10;
const MAX_ISSUE_MESSAGE_LENGTH = 200;

function formatPath(path: readonly PropertyKey[]): string {
  let result = '';
  for (const key of path) {
    if (typeof key === 'number') result += `[${String(key)}]`;
    else result += result === '' ? String(key) : `.${String(key)}`;
  }
  return result;
}

function validate<T>(schema: z.ZodType<T>, candidate: ValidationCandidate): ValidationResult<T> {
  if ('missing' in candidate) {
    return {
      ok: false,
      issues: [{ path: '', message: `The expected output is missing. ${candidate.missing}` }],
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(candidate.json);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'parse error';
    return { ok: false, issues: [{ path: '', message: `Invalid JSON (${reason})` }] };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    })),
  };
}

/** The correction sent back to the model: the issues (path: message) and what to do. */
export function formatValidationFeedback(issues: AiValidationIssue[], toolName?: string): string {
  const lines = issues.slice(0, MAX_FEEDBACK_ISSUES).map((issue) => {
    const message =
      issue.message.length > MAX_ISSUE_MESSAGE_LENGTH
        ? `${issue.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH)}…`
        : issue.message;
    return `- ${issue.path === '' ? '(root)' : issue.path}: ${message}`;
  });
  if (issues.length > MAX_FEEDBACK_ISSUES) {
    lines.push(`- …and ${String(issues.length - MAX_FEEDBACK_ISSUES)} more`);
  }
  return toolName === undefined
    ? [
        'Your previous output is invalid:',
        ...lines,
        'Respond again with the corrected output only, exactly in the required format.',
      ].join('\n')
    : [
        `The arguments of your call to "${toolName}" are invalid:`,
        ...lines,
        `Call "${toolName}" again with corrected arguments that match its parameters schema.`,
      ].join('\n');
}

/**
 * The arguments repeated in the assistant message of the retry. Some servers (Ollama, Gemini)
 * parse them on input and reject the request when they are not a JSON object; the broken text
 * itself is already quoted in the feedback.
 */
function echoedArguments(argumentsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return argumentsJson;
    }
  } catch {
    // Not JSON: replaced below.
  }
  return '{}';
}

/** Messages appended to the conversation so that the model can correct its output. */
function feedbackMessages(
  response: LlmResponse,
  candidate: ValidationCandidate,
  issues: AiValidationIssue[],
): LlmMessage[] {
  const invalidCall = 'toolCall' in candidate ? candidate.toolCall : undefined;
  if (invalidCall) {
    // Every tool call of the assistant message must be answered by a tool message.
    return [
      {
        role: 'assistant',
        content: response.text || null,
        toolCalls: response.toolCalls.map((call) => ({
          ...call,
          argumentsJson: echoedArguments(call.argumentsJson),
        })),
      },
      ...response.toolCalls.map((call): LlmMessage => ({
        role: 'tool',
        toolCallId: call.id,
        content:
          call.id === invalidCall.id
            ? formatValidationFeedback(issues, call.name)
            : 'Not executed, because another tool call in this response was invalid.',
      })),
    ];
  }
  // An empty assistant message (e.g. the model only called another tool, whose call is not
  // repeated here) is left out: some servers reject empty text.
  return [
    ...(response.text.trim() === ''
      ? []
      : [{ role: 'assistant' as const, content: response.text }]),
    { role: 'user', content: formatValidationFeedback(issues) },
  ];
}

/**
 * Calls the model and validates its output (JSON, then the Zod schema). An invalid output is
 * sent back to the model once, with the issues; if the second output is invalid too, an
 * `AiValidationError` is thrown. The helper has no side effects: callers act only on the
 * returned value. Provider failures (`LlmError`) are passed through; one failing on the retry
 * carries the `usage` of the first attempt.
 */
export async function runWithValidation<T>(
  options: RunWithValidationOptions<T>,
): Promise<ValidatedOutput<T>> {
  const { provider, request, schema, extract, onEvent } = options;

  const first = await collectResponse(provider.streamChat(request), (event) => onEvent?.(event, 1));
  const firstCandidate = extract(first);
  const firstResult = validate(schema, firstCandidate);
  if (firstResult.ok) {
    return { value: firstResult.value, attempts: 1, response: first, usage: first.usage };
  }

  const retryRequest: LlmRequest = {
    ...request,
    messages: [...request.messages, ...feedbackMessages(first, firstCandidate, firstResult.issues)],
  };
  let second: LlmResponse;
  try {
    second = await collectResponse(provider.streamChat(retryRequest), (event) =>
      onEvent?.(event, 2),
    );
  } catch (err) {
    // The tokens of the first attempt were spent and must still count against the limits.
    if (err instanceof LlmError) err.usage = addUsage(first.usage, err.usage);
    throw err;
  }
  const usage = addUsage(first.usage, second.usage);
  const secondResult = validate(schema, extract(second));
  if (secondResult.ok) {
    return { value: secondResult.value, attempts: 2, response: second, usage };
  }
  throw new AiValidationError(secondResult.issues, usage);
}
