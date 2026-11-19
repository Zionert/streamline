import { AI_BOARD_TOOL_NAMES, AI_ERROR_CODES, type AiMessage } from '@streamline/shared';

export const LIMIT_REACHED_MESSAGE =
  "You've reached today's assistant limit. It resets at midnight UTC.";
export const TURN_IN_PROGRESS_MESSAGE = 'The assistant is still answering in another tab.';
export const CONVERSATION_UNAVAILABLE_MESSAGE = 'This conversation is no longer available.';
export const NETWORK_ERROR_MESSAGE = 'Unable to reach the server. Please try again.';
export const UNKNOWN_ERROR_MESSAGE = 'Something went wrong. Please try again.';
const BUSY_MESSAGE = 'The assistant is busy right now. Please try again in a moment.';
const UNAVAILABLE_MESSAGE = 'The assistant is unavailable. Please try again later.';
const CLEARED_MESSAGE = 'The conversation was cleared.';

export interface TurnFailure {
  /** The question of the failed turn (sent again by "Try again"). */
  question: string;
  message: string;
  /** Offer "Try again" (not after the conversation was cleared). */
  canRetry: boolean;
}

/** What to show for an `error` event of the stream (`message` is the server's text). */
export function turnFailureFor(question: string, code: string, message: string): TurnFailure {
  switch (code) {
    case AI_ERROR_CODES.AI_PROVIDER_BUSY:
      return { question, message: BUSY_MESSAGE, canRetry: true };
    case AI_ERROR_CODES.AI_INVALID_OUTPUT:
      return { question, message: message || UNAVAILABLE_MESSAGE, canRetry: true };
    case AI_ERROR_CODES.AI_CONVERSATION_CLEARED:
      return { question, message: CLEARED_MESSAGE, canRetry: false };
    default:
      return { question, message: UNAVAILABLE_MESSAGE, canRetry: true };
  }
}

/** A stream that closed without its final event (e.g. a dropped connection). */
export function interruptedTurnFailure(question: string): TurnFailure {
  return { question, message: UNAVAILABLE_MESSAGE, canRetry: true };
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  [AI_BOARD_TOOL_NAMES.BOARD_OVERVIEW]: 'Read the board overview',
  [AI_BOARD_TOOL_NAMES.SEARCH_CARDS]: 'Searched cards',
  [AI_BOARD_TOOL_NAMES.FLOW_METRICS]: 'Read flow metrics',
  [AI_BOARD_TOOL_NAMES.FORECAST]: 'Ran the forecast',
};

/**
 * Label of a tool step. `get_card` names the card when its key is known (from the stored call's
 * arguments); the live stream does not carry arguments.
 */
export function toolStepLabel(name: string, args: unknown = null): string {
  if (name === AI_BOARD_TOOL_NAMES.GET_CARD) {
    const key = cardKeyOf(args);
    return key ? `Opened ${key}` : 'Opened a card';
  }
  return TOOL_LABELS[name] ?? `Used ${name}`;
}

function cardKeyOf(args: unknown): string | null {
  if (typeof args !== 'object' || args === null || !('key' in args)) {
    return null;
  }
  return typeof args.key === 'string' && args.key.trim() !== ''
    ? args.key.trim().toUpperCase()
    : null;
}

/** Whether a stored tool call succeeded (`toolResult` is `{ round, ok, ... }`). */
export function toolResultOk(result: unknown): boolean {
  return !(typeof result === 'object' && result !== null && 'ok' in result && result.ok === false);
}

export type ToolStepState = 'running' | 'ok' | 'failed';

export interface ToolStep {
  id: string;
  label: string;
  state: ToolStepState;
}

/** One item of the conversation as displayed. */
export type ChatEntry =
  | { kind: 'user'; message: AiMessage }
  /** An answer with the tool calls made for it; `message` is null for steps without an answer. */
  | { kind: 'assistant'; id: string; message: AiMessage | null; steps: ToolStep[] };

function stepOf(message: AiMessage): ToolStep {
  return {
    id: message.id,
    label: toolStepLabel(message.toolName ?? '', message.toolArgs),
    state: toolResultOk(message.toolResult) ? 'ok' : 'failed',
  };
}

/**
 * Groups stored messages for display: every `TOOL` row becomes a step of the assistant answer
 * that follows it (steps not followed by an answer, e.g. at the edge of a loaded page, are shown
 * on their own).
 */
export function chatEntries(messages: readonly AiMessage[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let steps: ToolStep[] = [];
  let firstStepId: string | null = null;
  const flushSteps = () => {
    if (steps.length > 0 && firstStepId) {
      entries.push({ kind: 'assistant', id: firstStepId, message: null, steps });
    }
    steps = [];
    firstStepId = null;
  };
  for (const message of messages) {
    if (message.role === 'TOOL') {
      firstStepId ??= message.id;
      steps.push(stepOf(message));
    } else if (message.role === 'ASSISTANT') {
      entries.push({ kind: 'assistant', id: message.id, message, steps });
      steps = [];
      firstStepId = null;
    } else {
      flushSteps();
      entries.push({ kind: 'user', message });
    }
  }
  flushSteps();
  return entries;
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Full date and time of a message (shown on hover only). */
export function messageTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso));
}
