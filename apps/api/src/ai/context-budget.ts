import type { LlmMessage, LlmToolDefinition } from './llm-provider.js';

/**
 * Token estimates and the fitting of a conversation into the model's context budget
 * (`LLM_CONTEXT_TOKENS`), without a tokenizer of the model.
 *
 * The estimate is deliberately conservative: English text averages about 4 characters per
 * token, but Polish and especially Ukrainian (Cyrillic) text needs more tokens per character,
 * so 3 characters per token keeps the real prompt below the budget for all three languages.
 */
export const CHARS_PER_TOKEN = 3;

/** Role markers and separators the chat template adds around every message. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Estimated tokens of a text: `ceil(length / 3)` (UTF-16 code units, so emoji count twice). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** The text of a message that its estimate counts (content, tool call ids, names, arguments). */
function messageText(message: LlmMessage): string {
  let text = message.content ?? '';
  if (message.role === 'assistant' && message.toolCalls) {
    for (const call of message.toolCalls) text += call.id + call.name + call.argumentsJson;
  }
  if (message.role === 'tool') text += message.toolCallId;
  return text;
}

export function estimateMessageTokens(message: LlmMessage): number {
  return estimateTokens(messageText(message)) + MESSAGE_OVERHEAD_TOKENS;
}

/** Tool definitions are sent as JSON next to the messages. */
export function estimateToolsTokens(tools: readonly LlmToolDefinition[] | undefined): number {
  return tools && tools.length > 0 ? estimateTokens(JSON.stringify(tools)) : 0;
}

export function estimateRequestTokens(
  messages: readonly LlmMessage[],
  tools?: readonly LlmToolDefinition[],
): number {
  return (
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0) +
    estimateToolsTokens(tools)
  );
}

/**
 * Part of the context window left for the model's answer (local servers such as Ollama count
 * the answer into the same window): a quarter of the budget, at most 2048 tokens.
 */
export function responseReserveTokens(contextTokens: number): number {
  return Math.min(2048, Math.floor(contextTokens / 4));
}

/** A message of the current turn; tool results can be shrunk when the turn alone is too big. */
export interface ContextTurnMessage {
  message: LlmMessage;
  /** Renders the message content in at most about `maxChars` characters. */
  shrink?: (maxChars: number) => string;
}

export interface FitContextInput {
  system: string;
  tools?: readonly LlmToolDefinition[] | undefined;
  /**
   * Previous messages, oldest first, in groups that must be kept or dropped together (an
   * assistant message calling tools and the results of those calls form one group).
   */
  history: readonly (readonly LlmMessage[])[];
  /** The user's message starting the current turn. */
  user: string;
  /** Messages of the current turn after the user's message (tool calls and their results). */
  turn: readonly ContextTurnMessage[];
  /** Most tokens the request may have (messages and tool definitions). */
  budget: number;
}

export interface FittedContext {
  messages: LlmMessage[];
  estimatedTokens: number;
  /** Previous messages left out because they did not fit. */
  droppedHistoryMessages: number;
  /** Tool results of the current turn that had to be shrunk. */
  shrunkToolResults: number;
}

function withContent(message: LlmMessage, content: string): LlmMessage {
  return { ...message, content };
}

/**
 * Builds the messages of a request within the token budget. Always kept: the system prompt, the
 * user's current message and every tool call and result of the current turn (results are shrunk,
 * oldest first, when the turn alone exceeds the budget, but never dropped). The remaining budget
 * goes to the newest previous messages, whole groups at a time, newest first; the kept history
 * then starts with a user message (a leading assistant answer or tool group whose question was
 * dropped is left out too).
 */
export function fitContext(input: FitContextInput): FittedContext {
  const { system, tools, history, user, turn, budget } = input;
  const systemMessage: LlmMessage = { role: 'system', content: system };
  const userMessage: LlmMessage = { role: 'user', content: user };

  const fixed =
    estimateMessageTokens(systemMessage) +
    estimateMessageTokens(userMessage) +
    estimateToolsTokens(tools);

  const turnMessages = turn.map((entry) => entry.message);
  const turnTokens = () =>
    turnMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  let shrunkToolResults = 0;
  let overflow = fixed + turnTokens() - budget;
  /** Attempts per result: a shrunk text may still be a little longer than asked for. */
  const maxAttempts = 3;
  for (let index = 0; index < turn.length && overflow > 0; index += 1) {
    const shrink = turn[index]?.shrink;
    if (!shrink) continue;
    let shrunkThis = false;
    for (let attempt = 0; attempt < maxAttempts && overflow > 0; attempt += 1) {
      const message = turnMessages[index];
      if (!message) break;
      const current = estimateMessageTokens(message);
      const otherChars = messageText(message).length - (message.content ?? '').length;
      const targetTokens = current - overflow - MESSAGE_OVERHEAD_TOKENS;
      const allowedChars = Math.max(0, targetTokens * CHARS_PER_TOKEN - otherChars);
      const shrunk = withContent(message, shrink(allowedChars));
      if (estimateMessageTokens(shrunk) >= current) break;
      turnMessages[index] = shrunk;
      shrunkThis = true;
      overflow = fixed + turnTokens() - budget;
    }
    if (shrunkThis) shrunkToolResults += 1;
  }

  let remaining = budget - fixed - turnTokens();
  const kept: (readonly LlmMessage[])[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const group = history[index] ?? [];
    const tokens = group.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    if (tokens > remaining) break;
    kept.unshift(group);
    remaining -= tokens;
  }
  while (kept.length > 0 && kept[0]?.[0]?.role !== 'user') kept.shift();

  const keptMessages = kept.flat();
  const totalHistory = history.reduce((sum, group) => sum + group.length, 0);
  const messages = [systemMessage, ...keptMessages, userMessage, ...turnMessages];
  return {
    messages,
    estimatedTokens: estimateRequestTokens(messages, tools),
    droppedHistoryMessages: totalHistory - keptMessages.length,
    shrunkToolResults,
  };
}
