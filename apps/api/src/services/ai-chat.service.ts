import {
  AI_ERROR_CODES,
  type AiChatEventName,
  type AiChatEventPayloads,
  type AiJsonValue,
  type AiTokenUsage,
  type SendAiMessageInput,
} from '@streamline/shared';
import type { Logger } from 'pino';
import { z } from 'zod';

import { AiValidationError, LlmError, type AiValidationIssue } from '../ai/ai-errors.js';
import {
  estimateRequestTokens,
  estimateTokens,
  fitContext,
  responseReserveTokens,
  type ContextTurnMessage,
} from '../ai/context-budget.js';
import type {
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmToolCall,
  LlmToolDefinition,
  LlmUsage,
} from '../ai/llm-provider.js';
import {
  collectResponse,
  echoedArguments,
  formatValidationFeedback,
} from '../ai/run-with-validation.js';
import { AppError, ConflictError, NotFoundError } from '../errors/app-error.js';
import type {
  AiConversationRepository,
  AiMessageRecord,
  NewAiMessageData,
} from '../repositories/ai-conversation.repository.js';
import type { AiDailyLimits, AiUsageRepository } from '../repositories/ai-usage.repository.js';
import { buildSystemPrompt, type PromptBoard } from './ai-chat-prompt.js';
import { conversationNotFound, toAiMessage, toJsonValue } from './ai-conversation.service.js';
import type { BoardToolOutcome, BoardToolSet } from './ai-tools/board-tools.js';
import {
  fitJson,
  redactEmailsDeep,
  renderBoardData,
  TOOL_RESULT_MAX_CHARS,
} from './ai-tools/tool-result.js';
import type { BoardAccessService, BoardMembership } from './board-access.service.js';
import type { BoardService } from './board.service.js';

/** Receives the Server-Sent Events of a turn. */
export interface AiChatSink {
  send<E extends AiChatEventName>(event: E, data: AiChatEventPayloads[E]): void;
}

export interface RunTurnOptions {
  userId: string;
  conversationId: string;
  input: SendAiMessageInput;
  /**
   * Aborted when the client disconnects: the turn stops and saves no messages. Only an abort that
   * arrives while the finished turn is already being saved cannot stop it; the turn is then kept
   * (and logged as saved after the disconnect).
   */
  signal: AbortSignal;
  /**
   * Called once every check has passed (conversation, access, no other turn, limits): starts the
   * event stream. Errors before it are thrown (normal JSON error responses); errors after it are
   * reported as an `error` event.
   */
  open: () => AiChatSink;
}

/**
 * One turn of a conversation with the AI assistant: the user's message, up to
 * {@link MAX_TOOL_ROUNDS} rounds of read-only tool calls (board chats only) and the answer,
 * streamed as it is generated. The turn is stored (user message, one row per tool call, the
 * answer) in one transaction only when it succeeds; a failed or cancelled turn leaves no
 * messages, but its tokens still count against the daily limits.
 */
export interface AiChatService {
  runTurn(options: RunTurnOptions): Promise<void>;
}

export interface AiChatServiceDependencies {
  llm: LlmProvider;
  conversations: Pick<AiConversationRepository, 'findOwned' | 'listMessages' | 'saveTurn'>;
  usage: Pick<AiUsageRepository, 'reserveRequest' | 'addTokens'>;
  boardAccess: Pick<BoardAccessService, 'require'>;
  boardService: Pick<BoardService, 'get'>;
  tools: BoardToolSet;
  logger: Logger;
  now?: () => Date;
  limits: AiDailyLimits;
  /** `LLM_CONTEXT_TOKENS`: the context window the requests must fit in. */
  contextTokens: number;
}

/** Rounds of tool calls per turn; then the model must answer without tools. */
export const MAX_TOOL_ROUNDS = 4;
/** Newest stored messages considered for the history (then trimmed to the budget). */
export const HISTORY_MESSAGES_LOADED = 200;

export const AI_PROVIDER_BUSY_MESSAGE =
  'The assistant is busy right now. Please try again in a moment.';
const AI_PROVIDER_ERROR_MESSAGE = 'The assistant is unavailable right now. Please try again later.';
const AI_PROVIDER_TIMEOUT_MESSAGE = 'The assistant took too long to answer. Please try again.';
const AI_INTERNAL_ERROR_MESSAGE = 'Something went wrong while answering. Please try again.';
const REQUEST_LIMIT_MESSAGE =
  'You have reached the daily limit of assistant requests. It resets at midnight UTC.';
const TOKEN_LIMIT_MESSAGE =
  'You have reached the daily limit of assistant usage. It resets at midnight UTC.';
const TURN_IN_PROGRESS_MESSAGE =
  'The assistant is still answering your previous message in this conversation.';
export const EMPTY_ANSWER_FALLBACK =
  'I could not put together an answer. Please try rephrasing your question.';
export const ROUND_LIMIT_FALLBACK =
  'I could not finish looking through the board in one answer. Please ask a narrower question.';
const NOT_EXECUTED_RESULT = 'Not executed, because another tool call in this response was invalid.';
export const REASONING_EFFORT_HINT = 'set LLM_REASONING_EFFORT=default';
const CONVERSATION_CLEARED_MESSAGE =
  'The conversation was cleared while the assistant was answering, so the answer was not saved.';

/** Copies the provider's opaque call data into JSON (dropping non-JSON values). */
function toJsonRecord(value: Record<string, unknown>): Record<string, AiJsonValue> {
  const parsed = z.record(z.string(), z.json()).safeParse(JSON.parse(JSON.stringify(value)));
  return parsed.success ? parsed.data : {};
}

/**
 * What a stored `TOOL` row keeps in `toolResult`: the result of the call, plus what is needed to
 * rebuild the assistant's tool-call request from the rows (`round` groups the calls of one model
 * response; `extraContent` is the provider's opaque data of the call, e.g. a Gemini thought
 * signature, which must be sent back unchanged with the call).
 */
const storedToolResultSchema = z.object({
  /** Index of the model response (within its turn) that made the call. */
  round: z.int().min(1),
  ok: z.boolean(),
  data: z.json().optional(),
  error: z.string().optional(),
  extraContent: z.record(z.string(), z.json()).optional(),
});

type StoredToolResult = z.infer<typeof storedToolResultSchema>;

/** The UTC calendar day of an instant, as stored in `AiUsage.day`. */
export function utcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/** Board data as the model sees it (the wrapper is added to successful results only). */
export function toolMessageContent(
  toolName: string,
  outcome: BoardToolOutcome,
  maxChars = TOOL_RESULT_MAX_CHARS,
): string {
  return outcome.ok ? renderBoardData(toolName, outcome.data, maxChars) : `Error: ${outcome.error}`;
}

/** The raw arguments of a call as JSON to store: the parsed value, or the text if not JSON. */
function storedArguments(argumentsJson: string): AiJsonValue {
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    const json = z.json().safeParse(parsed);
    if (json.success && json.data !== null) return redactEmailsDeep(json.data);
  } catch {
    // Not JSON: stored as text below.
  }
  return argumentsJson;
}

function argumentsFromStored(toolArgs: AiMessageRecord['toolArgs']): string {
  return echoedArguments(typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs ?? {}));
}

function storedOutcome(result: StoredToolResult): BoardToolOutcome {
  if (result.ok && result.data !== undefined) return { ok: true, data: result.data };
  return { ok: false, error: result.error ?? 'No result.' };
}

/**
 * Rebuilds the model messages of stored history (oldest first) in groups that must stay
 * together: a user message, an answer, or one assistant tool-call request with the results of
 * its calls (consecutive `TOOL` rows of the same round).
 */
export function historyGroups(rows: readonly AiMessageRecord[]): LlmMessage[][] {
  const groups: LlmMessage[][] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    index += 1;
    if (!row) continue;
    if (row.role === 'USER') {
      groups.push([{ role: 'user', content: row.content }]);
      continue;
    }
    if (row.role === 'ASSISTANT') {
      if (row.content.trim() !== '') groups.push([{ role: 'assistant', content: row.content }]);
      continue;
    }
    const calls = [row];
    const round = storedToolResultSchema.safeParse(row.toolResult);
    while (round.success && index < rows.length) {
      const next = rows[index];
      const nextRound = next?.role === 'TOOL' && storedToolResultSchema.safeParse(next.toolResult);
      if (!next || !nextRound || !nextRound.success || nextRound.data.round !== round.data.round) {
        break;
      }
      calls.push(next);
      index += 1;
    }
    const toolCalls: LlmToolCall[] = calls.map((call) => {
      const stored = storedToolResultSchema.safeParse(call.toolResult);
      const extraContent = stored.success ? stored.data.extraContent : undefined;
      return {
        id: call.toolCallId ?? `call_${call.id}`,
        name: call.toolName ?? 'unknown_tool',
        argumentsJson: argumentsFromStored(call.toolArgs),
        ...(extraContent && { extraContent }),
      };
    });
    groups.push([
      { role: 'assistant', content: null, toolCalls },
      ...calls.map((call, callIndex): LlmMessage => {
        const stored = storedToolResultSchema.safeParse(call.toolResult);
        const name = call.toolName ?? 'unknown_tool';
        const outcome: BoardToolOutcome = stored.success
          ? storedOutcome(stored.data)
          : { ok: true, data: redactEmailsDeep(toJsonValue(call.toolResult ?? null)) };
        return {
          role: 'tool',
          toolCallId: toolCalls[callIndex]?.id ?? '',
          content: toolMessageContent(name, outcome),
        };
      }),
    ]);
  }
  return groups;
}

/** A tool call of the current turn: what the model sees and what will be stored. */
interface TurnToolCall {
  call: LlmToolCall;
  outcome: BoardToolOutcome;
}

/** The messages of the current turn after the user's message (tool calls and results). */
function turnToolMessages(calls: readonly TurnToolCall[], text: string): ContextTurnMessage[] {
  return [
    {
      message: {
        role: 'assistant',
        content: text === '' ? null : text,
        toolCalls: calls.map(({ call }) => ({
          ...call,
          argumentsJson: echoedArguments(call.argumentsJson),
        })),
      },
    },
    ...calls.map(({ call, outcome }): ContextTurnMessage => ({
      message: {
        role: 'tool',
        toolCallId: call.id,
        content: toolMessageContent(call.name, outcome),
      },
      ...(outcome.ok && {
        shrink: (maxChars: number) => toolMessageContent(call.name, outcome, maxChars),
      }),
    })),
  ];
}

/** Prompt budget of one request: the context window minus room for the answer. */
export function promptBudget(contextTokens: number): number {
  return contextTokens - responseReserveTokens(contextTokens);
}

/** A failure reported to the client as an `error` event. */
interface TurnFailure {
  code: string;
  message: string;
}

function isProviderBusy(err: LlmError): boolean {
  return err.code === 'LLM_UNAVAILABLE' || err.providerStatus === 429 || err.providerStatus === 503;
}

function toTurnFailure(err: unknown): TurnFailure {
  if (err instanceof AiValidationError) {
    return { code: AI_ERROR_CODES.AI_INVALID_OUTPUT, message: err.message };
  }
  if (err instanceof LlmError) {
    if (isProviderBusy(err)) {
      return { code: AI_ERROR_CODES.AI_PROVIDER_BUSY, message: AI_PROVIDER_BUSY_MESSAGE };
    }
    return {
      code: AI_ERROR_CODES.AI_PROVIDER_ERROR,
      message: err.code === 'LLM_TIMEOUT' ? AI_PROVIDER_TIMEOUT_MESSAGE : AI_PROVIDER_ERROR_MESSAGE,
    };
  }
  if (
    err instanceof AppError &&
    (err.code === AI_ERROR_CODES.CONVERSATION_NOT_FOUND ||
      err.code === AI_ERROR_CODES.AI_CONVERSATION_CLEARED)
  ) {
    return { code: err.code, message: err.message };
  }
  return { code: AI_ERROR_CODES.AI_INTERNAL_ERROR, message: AI_INTERNAL_ERROR_MESSAGE };
}

/** The provider rejected the `reasoning_effort` field (e.g. Gemini with `none`). */
function isReasoningRejected(err: unknown): err is LlmError {
  return (
    err instanceof LlmError &&
    err.providerStatus === 400 &&
    /reasoning/i.test(err.providerMessage ?? '')
  );
}

/** Usage estimated from the request and the received output (provider reported none). */
function estimateUsage(request: LlmRequest, output: string): LlmUsage {
  return {
    promptTokens: estimateRequestTokens(request.messages, request.tools),
    completionTokens: estimateTokens(output),
  };
}

export interface BoardContextPreviewInput {
  tools: BoardToolSet;
  boardService: Pick<BoardService, 'get'>;
  membership: BoardMembership;
  question: string;
  now: Date;
  contextTokens: number;
}

/**
 * The request a board chat would send after reading the board overview and the card list (for
 * latency measurements with a realistic prompt): the same system prompt, tool definitions,
 * tool result format and context fitting as a real turn.
 */
export async function buildBoardContextPreview(
  input: BoardContextPreviewInput,
): Promise<{ request: LlmRequest; estimatedTokens: number }> {
  const { tools, boardService, membership, question, now, contextTokens } = input;
  const board = await boardService.get(membership);
  const context = { membership, now };
  const calls: TurnToolCall[] = [];
  // These calls are made up here, not produced by the model, so they have no thought signature.
  // Gemini rejects a current-turn function call without one (HTTP 400); its documented dummy
  // value skips that validation. Only this measurement preview uses it, never a real chat turn,
  // where the model's own signatures are passed back.
  const extraContent = { google: { thought_signature: 'skip_thought_signature_validator' } };
  const planned: LlmToolCall[] = [
    { id: 'call_overview', name: 'get_board_overview', argumentsJson: '{}', extraContent },
    { id: 'call_cards', name: 'search_cards', argumentsJson: '{"limit":50}', extraContent },
  ];
  for (const call of planned) {
    const checked = tools.check(call);
    if (!checked.ok) throw new Error(`Invalid preview tool call ${call.name}`);
    const outcome = await checked.run(context);
    calls.push({
      call,
      outcome: outcome.ok
        ? { ok: true, data: fitJson(outcome.data, TOOL_RESULT_MAX_CHARS).value }
        : outcome,
    });
  }
  const fitted = fitContext({
    system: buildSystemPrompt({
      board: { name: board.name, key: board.key },
      today: now.toISOString().slice(0, 10),
    }),
    tools: tools.definitions,
    history: [],
    user: question,
    turn: turnToolMessages(calls, ''),
    budget: promptBudget(contextTokens),
  });
  return {
    request: { messages: fitted.messages, tools: tools.definitions },
    estimatedTokens: fitted.estimatedTokens,
  };
}

export function createAiChatService(deps: AiChatServiceDependencies): AiChatService {
  const { llm, conversations, usage, boardAccess, boardService, tools, logger, limits } = deps;
  const now = deps.now ?? (() => new Date());
  const budget = promptBudget(deps.contextTokens);

  /**
   * Conversations with a turn in progress. The lock lives in this process: it is correct for the
   * single API instance the application runs as; several instances would need a shared lock
   * (e.g. in the database).
   */
  const activeTurns = new Set<string>();

  /** The caller's board membership and the board of a board chat; 404 when access was lost. */
  async function boardOf(
    boardId: string,
    userId: string,
  ): Promise<{ membership: BoardMembership; board: PromptBoard }> {
    try {
      const membership = await boardAccess.require(boardId, userId, 'board:view');
      const board = await boardService.get(membership);
      return { membership, board: { name: board.name, key: board.key } };
    } catch (err) {
      if (err instanceof NotFoundError) throw conversationNotFound();
      throw err;
    }
  }

  return {
    async runTurn({ userId, conversationId, input, signal, open }) {
      const conversation = await conversations.findOwned(userId, conversationId);
      if (!conversation) throw conversationNotFound();
      const boardChat =
        conversation.boardId === null ? null : await boardOf(conversation.boardId, userId);

      if (activeTurns.has(conversationId)) {
        throw new ConflictError(TURN_IN_PROGRESS_MESSAGE, AI_ERROR_CODES.AI_TURN_IN_PROGRESS);
      }
      activeTurns.add(conversationId);
      try {
        if (signal.aborted) {
          // The client left before the turn started: no daily request is used.
          logger.info(
            { conversationId, userId },
            'AI turn cancelled by the client before it started',
          );
          return;
        }
        // Read again under the lock: a turn that just finished may have bumped `updatedAt` after
        // the first read, which would otherwise look like a concurrent clear when saving.
        const current = await conversations.findOwned(userId, conversationId);
        if (!current) throw conversationNotFound();
        const startedAt = now();
        const day = utcDay(startedAt);
        const reservation = await usage.reserveRequest(userId, day, limits);
        if (reservation.status === 'limit-reached') {
          throw new AppError(
            429,
            AI_ERROR_CODES.AI_LIMIT_REACHED,
            reservation.limit === 'requests' ? REQUEST_LIMIT_MESSAGE : TOKEN_LIMIT_MESSAGE,
          );
        }
        const sink = open();
        await runOpenTurn({
          userId,
          conversationId,
          content: input.content,
          signal,
          sink,
          startedAt,
          day,
          boardChat,
          conversationUpdatedAt: current.updatedAt,
        });
      } finally {
        activeTurns.delete(conversationId);
      }
    },
  };

  async function runOpenTurn(turn: {
    userId: string;
    conversationId: string;
    content: string;
    signal: AbortSignal;
    sink: AiChatSink;
    startedAt: Date;
    day: Date;
    boardChat: { membership: BoardMembership; board: PromptBoard } | null;
    /** `updatedAt` of the conversation when the turn started (detects a concurrent clear). */
    conversationUpdatedAt: Date;
  }): Promise<void> {
    const { userId, conversationId, content, signal, sink, startedAt, boardChat } = turn;
    const spent: AiTokenUsage = { promptTokens: 0, completionTokens: 0 };
    let tokensRecorded = false;
    /** Adds the turn's tokens to the daily usage once (before `done`, or at the end). */
    const recordTokens = async () => {
      if (tokensRecorded) return;
      tokensRecorded = true;
      if (spent.promptTokens === 0 && spent.completionTokens === 0) return;
      try {
        await usage.addTokens(userId, turn.day, spent);
      } catch (err) {
        logger.error({ err, conversationId, userId }, 'Failed to record AI token usage');
      }
    };
    const send: AiChatSink['send'] = (event, data) => {
      if (!signal.aborted) sink.send(event, data);
    };

    try {
      const rows = (
        await conversations.listMessages(conversationId, { limit: HISTORY_MESSAGES_LOADED - 1 })
      ).reverse();
      const history = historyGroups(rows);
      const system = buildSystemPrompt({
        board: boardChat?.board ?? null,
        today: startedAt.toISOString().slice(0, 10),
      });
      const toolDefinitions: LlmToolDefinition[] | undefined = boardChat
        ? tools.definitions
        : undefined;

      const turnMessages: ContextTurnMessage[] = [];
      const toolRows: Omit<NewAiMessageData, 'createdAt'>[] = [];
      let visibleText = '';
      let toolRounds = 0;
      let responses = 0;
      let correctionUsed = false;
      let answer: string | null = null;

      const callModel = async (
        requestTools: LlmToolDefinition[] | undefined,
        toolChoice: LlmRequest['toolChoice'],
      ) => {
        const { messages } = fitContext({
          system,
          tools: requestTools,
          history,
          user: content,
          turn: turnMessages,
          budget,
        });
        const request: LlmRequest = {
          messages,
          tools: requestTools,
          signal,
          ...(requestTools && toolChoice && { toolChoice }),
        };
        let received = false;
        let output = '';
        let roundHasText = false;
        const add = (usageOfCall: LlmUsage) => {
          spent.promptTokens += usageOfCall.promptTokens;
          spent.completionTokens += usageOfCall.completionTokens;
        };
        try {
          const response = await collectResponse(llm.streamChat(request), (event) => {
            received = true;
            if (event.type === 'tool-call') output += event.name + event.argumentsJson;
            if (event.type !== 'text-delta' || event.text === '') return;
            output += event.text;
            const text = !roundHasText && visibleText !== '' ? `\n\n${event.text}` : event.text;
            roundHasText = true;
            visibleText += text;
            send('delta', { text });
          });
          add(response.usage ?? estimateUsage(request, output));
          return { response, roundHasText };
        } catch (err) {
          if (err instanceof LlmError && err.usage) add(err.usage);
          else if (received) add(estimateUsage(request, output));
          throw err;
        }
      };

      const finishWith = (fallback: string): string => {
        const text = visibleText === '' ? fallback : `\n\n${fallback}`;
        visibleText += text;
        send('delta', { text });
        return visibleText;
      };

      while (answer === null) {
        const toolsAllowed = toolDefinitions !== undefined && toolRounds < MAX_TOOL_ROUNDS;
        // After the last tool round the tools stay defined (the turn already contains tool calls
        // and results) but the model must answer with text.
        const { response, roundHasText } = await callModel(
          toolDefinitions,
          toolsAllowed ? 'auto' : 'none',
        );
        signal.throwIfAborted();

        if (response.toolCalls.length === 0 || !toolsAllowed) {
          if (roundHasText) answer = visibleText;
          else if (response.toolCalls.length > 0 && toolDefinitions !== undefined) {
            answer = finishWith(ROUND_LIMIT_FALLBACK);
          } else answer = finishWith(EMPTY_ANSWER_FALLBACK);
          break;
        }

        responses += 1;
        const round = responses;
        const checked = response.toolCalls.map((call) => ({ call, check: tools.check(call) }));
        const invalid = checked.filter((entry) => !entry.check.ok);
        const calls: TurnToolCall[] = [];

        if (invalid.length > 0) {
          const issues: AiValidationIssue[] = invalid.flatMap(({ check }) =>
            check.ok ? [] : check.issues,
          );
          if (correctionUsed) throw new AiValidationError(issues, { ...spent });
          correctionUsed = true;
          for (const { call, check } of checked) {
            const error = check.ok
              ? NOT_EXECUTED_RESULT
              : formatValidationFeedback(check.issues, call.name);
            send('tool', { id: call.id, name: call.name, status: 'started' });
            send('tool', { id: call.id, name: call.name, status: 'finished', ok: false });
            calls.push({ call, outcome: { ok: false, error } });
          }
        } else {
          toolRounds += 1;
          if (!boardChat) throw new Error('Board tools need a board');
          for (const { call, check } of checked) {
            if (!check.ok) continue;
            send('tool', { id: call.id, name: call.name, status: 'started' });
            const outcome = await check.run({ membership: boardChat.membership, now: now() });
            signal.throwIfAborted();
            const stored: BoardToolOutcome = outcome.ok
              ? { ok: true, data: fitJson(outcome.data, TOOL_RESULT_MAX_CHARS).value }
              : outcome;
            send('tool', { id: call.id, name: call.name, status: 'finished', ok: outcome.ok });
            calls.push({ call, outcome: stored });
          }
        }

        turnMessages.push(...turnToolMessages(calls, response.text));
        for (const { call, outcome } of calls) {
          const result: StoredToolResult = {
            ...(outcome.ok
              ? { round, ok: true, data: outcome.data }
              : { round, ok: false, error: outcome.error }),
            ...(call.extraContent && { extraContent: toJsonRecord(call.extraContent) }),
          };
          toolRows.push({
            role: 'TOOL',
            content: '',
            toolName: call.name,
            toolCallId: call.id,
            toolArgs: storedArguments(call.argumentsJson),
            toolResult: result,
          });
        }
      }

      signal.throwIfAborted();
      const base = startedAt.getTime();
      const rowsOfTurn: Omit<NewAiMessageData, 'createdAt'>[] = [
        { role: 'USER', content },
        ...toolRows,
        { role: 'ASSISTANT', content: answer },
      ];
      // Explicit, increasing timestamps keep the stored order of the turn deterministic.
      const toSave = rowsOfTurn.map((row, index) => ({
        ...row,
        createdAt: new Date(base + index),
      }));
      const saved = await conversations.saveTurn(
        conversationId,
        toSave,
        turn.conversationUpdatedAt,
      );
      if (saved.status === 'missing') throw conversationNotFound();
      if (saved.status === 'changed') {
        logger.info({ conversationId, userId }, 'AI turn not saved: the conversation was cleared');
        throw new AppError(
          409,
          AI_ERROR_CODES.AI_CONVERSATION_CLEARED,
          CONVERSATION_CLEARED_MESSAGE,
        );
      }
      if (signal.aborted) {
        logger.info({ conversationId, userId }, 'AI turn saved after the client disconnected');
      }
      await recordTokens();
      send('done', { messages: saved.rows.map(toAiMessage), usage: { ...spent } });
    } catch (err) {
      if (signal.aborted) {
        logger.info({ conversationId, userId }, 'AI turn cancelled by the client');
      } else {
        reportFailure(err, { conversationId, userId }, send);
      }
    } finally {
      await recordTokens();
    }
  }

  function reportFailure(
    err: unknown,
    context: { conversationId: string; userId: string },
    send: AiChatSink['send'],
  ): void {
    const failure = toTurnFailure(err);
    const providerStatus = err instanceof LlmError ? err.providerStatus : undefined;
    const logContext = {
      ...context,
      code: failure.code,
      providerStatus,
      ...(err instanceof AppError && { errorCode: err.code }),
    };
    if (isReasoningRejected(err)) {
      logger.error(
        { ...logContext, providerMessage: err.providerMessage, hint: REASONING_EFFORT_HINT },
        `The model provider rejected the reasoning_effort field: ${REASONING_EFFORT_HINT}`,
      );
    } else if (failure.code === AI_ERROR_CODES.AI_INTERNAL_ERROR) {
      logger.error({ ...logContext, err }, 'AI turn failed');
    } else {
      logger.warn(
        {
          ...logContext,
          ...(err instanceof LlmError && { providerMessage: err.providerMessage }),
          ...(err instanceof AiValidationError && { issues: err.issues.length }),
        },
        'AI turn failed',
      );
    }
    send('error', failure);
  }
}
