import {
  AI_BOARD_TOOL_NAMES,
  AI_FLOW_METRICS_DEFAULT_DAYS,
  AI_SEARCH_CARDS_DEFAULT_LIMIT,
  addDays,
  aiBoardOverviewArgsSchema,
  aiFlowMetricsArgsSchema,
  aiForecastArgsSchema,
  aiGetCardArgsSchema,
  aiSearchCardsArgsSchema,
  cardKeySchema,
  forecastQuerySchema,
  toLocalDateKey,
  type AiJsonValue,
  type Card,
  type Column,
  type ForecastResponse,
} from '@streamline/shared';
import { z } from 'zod';

import { AppError, NotFoundError, ValidationError } from '../../errors/app-error.js';
import type { JsonSchema, LlmToolCall, LlmToolDefinition } from '../../ai/llm-provider.js';
import type { AiValidationIssue } from '../../ai/ai-errors.js';
import { validateCandidate } from '../../ai/run-with-validation.js';
import type { AnalyticsService } from '../analytics.service.js';
import type { BoardMembership } from '../board-access.service.js';
import type { BoardService } from '../board.service.js';
import type { CardService } from '../card.service.js';
import type { ColumnService } from '../column.service.js';
import type { CommentService } from '../comment.service.js';
import type { LabelService } from '../label.service.js';
import { redactEmailsDeep } from './tool-result.js';

/**
 * Read-only tools of the AI assistant in a board chat. They read the board through the regular
 * services with the caller's membership (so the same permissions apply) and return compact JSON
 * without email addresses or internal ids. The board is always the conversation's board: no tool
 * takes a board argument.
 */

/** What a tool call runs with: the caller's verified membership and the current time. */
export interface BoardToolContext {
  membership: BoardMembership;
  now: Date;
}

/** Outcome of a tool call; a failed call (e.g. unknown card) is reported to the model as such. */
export type BoardToolOutcome = { ok: true; data: AiJsonValue } | { ok: false; error: string };

/** A tool call with arguments that passed validation, ready to run. */
export type CheckedToolCall =
  | { ok: true; run: (context: BoardToolContext) => Promise<BoardToolOutcome> }
  | { ok: false; issues: AiValidationIssue[] };

export interface BoardToolSet {
  /** Definitions sent to the model. */
  definitions: LlmToolDefinition[];
  /** Validates the arguments of a call (unknown tools are reported as invalid). */
  check(call: LlmToolCall): CheckedToolCall;
}

export interface BoardToolServices {
  boardService: Pick<BoardService, 'get' | 'listMembers'>;
  columnService: Pick<ColumnService, 'list'>;
  cardService: Pick<CardService, 'list' | 'getByKey'>;
  labelService: Pick<LabelService, 'list'>;
  commentService: Pick<CommentService, 'list'>;
  analyticsService: Pick<AnalyticsService, 'getAnalytics' | 'forecast'>;
}

/** Time zone of the analytics tools (the assistant does not know the user's zone). */
const TOOL_TIME_ZONE = 'UTC';
const CARD_DESCRIPTION_MAX_CHARS = 2000;
const COMMENT_MAX_CHARS = 500;
const CARD_COMMENTS_SHOWN = 5;
const COMMENTS_READ_LIMIT = 100;
const AGING_ITEMS_SHOWN = 10;

interface ToolSpec<T> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  execute: (args: T, context: BoardToolContext) => Promise<AiJsonValue>;
}

/** A tool with its argument type hidden behind validation. */
interface BoardTool {
  definition: LlmToolDefinition;
  check(argumentsJson: string): CheckedToolCall;
}

/** JSON Schema of the arguments as the model should send them. */
export function toolParameters(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(schema, { io: 'input' });
  return parameters;
}

/**
 * Turns an expected failure of a service (missing card, invalid forecast date) into a failed
 * tool result; anything else is a real error of the turn.
 */
function expectedFailure(err: unknown): string | null {
  if (err instanceof ValidationError) {
    const issues = z.array(z.object({ message: z.string() })).safeParse(err.details);
    return issues.success && issues.data.length > 0
      ? issues.data.map((issue) => issue.message).join('; ')
      : err.message;
  }
  if (err instanceof NotFoundError) return err.message;
  if (err instanceof AppError && err.statusCode < 500) return err.message;
  return null;
}

function defineTool<T>(spec: ToolSpec<T>): BoardTool {
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      parameters: toolParameters(spec.schema),
    },
    check(argumentsJson) {
      const result = validateCandidate(spec.schema, { json: argumentsJson });
      if (!result.ok) return { ok: false, issues: result.issues };
      return {
        ok: true,
        async run(context) {
          try {
            return { ok: true, data: redactEmailsDeep(await spec.execute(result.value, context)) };
          } catch (err) {
            const message = expectedFailure(err);
            if (message === null) throw err;
            return { ok: false, error: message };
          }
        },
      };
    },
  };
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function truncateText(text: string | null, maxChars: number): string | null {
  if (text === null || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… (shortened)`;
}

const includesFolded = (text: string, part: string) =>
  text.toLocaleLowerCase().includes(part.toLocaleLowerCase());
const equalsFolded = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Lookup tables to describe cards by names instead of ids. */
interface BoardNames {
  columns: Column[];
  columnById: Map<string, Column>;
  memberName: Map<string, string>;
  labelName: Map<string, string>;
}

export function createBoardTools(services: BoardToolServices): BoardToolSet {
  const { boardService, columnService, cardService, labelService, commentService } = services;
  const { analyticsService } = services;

  async function loadNames(membership: BoardMembership): Promise<BoardNames> {
    const [columns, members, labels] = await Promise.all([
      columnService.list(membership),
      boardService.listMembers(membership),
      labelService.list(membership),
    ]);
    return {
      columns,
      columnById: new Map(columns.map((column) => [column.id, column])),
      memberName: new Map(members.map((member) => [member.userId, member.name])),
      labelName: new Map(labels.map((label) => [label.id, label.name])),
    };
  }

  function describeCard(card: Card, names: BoardNames) {
    return {
      key: card.key,
      title: card.title,
      column: names.columnById.get(card.columnId)?.title ?? null,
      priority: card.priority,
      assignee: card.assigneeId === null ? null : (names.memberName.get(card.assigneeId) ?? null),
      dueDate: card.dueDate,
      labels: card.labelIds.flatMap((id) => {
        const name = names.labelName.get(id);
        return name === undefined ? [] : [name];
      }),
    };
  }

  const tools: BoardTool[] = [
    defineTool({
      name: AI_BOARD_TOOL_NAMES.BOARD_OVERVIEW,
      description:
        'Overview of the current board: name, key, columns in order (category, WIP limit, ' +
        'number of cards), member names and labels.',
      schema: aiBoardOverviewArgsSchema,
      async execute(_args, { membership }) {
        const [board, names, columnCards, members] = await Promise.all([
          boardService.get(membership),
          loadNames(membership),
          cardService.list(membership),
          boardService.listMembers(membership),
        ]);
        const counts = new Map(columnCards.map((entry) => [entry.columnId, entry.cards.length]));
        return {
          board: { name: board.name, key: board.key },
          currentUser: names.memberName.get(membership.userId) ?? null,
          columns: names.columns.map((column) => ({
            title: column.title,
            category: column.category,
            wipLimit: column.wipLimit,
            wipStrict: column.wipStrict,
            cards: counts.get(column.id) ?? 0,
          })),
          totalCards: columnCards.reduce((sum, entry) => sum + entry.cards.length, 0),
          members: members.map((member) => member.name),
          labels: [...names.labelName.values()],
        };
      },
    }),

    defineTool({
      name: AI_BOARD_TOOL_NAMES.SEARCH_CARDS,
      description:
        'Lists cards of the current board in board order, optionally filtered by text, column, ' +
        'assignee and label (all given filters must match). Returns at most 50 cards and says ' +
        'whether the list was cut.',
      schema: aiSearchCardsArgsSchema,
      async execute(args, { membership }) {
        const [names, columnCards] = await Promise.all([
          loadNames(membership),
          cardService.list(membership),
        ]);
        const notes: string[] = [];

        let columnIds: Set<string> | null = null;
        if (args.column !== undefined) {
          const wanted = args.column;
          const exact = names.columns.filter((column) => equalsFolded(column.title, wanted));
          const matching =
            exact.length > 0
              ? exact
              : names.columns.filter((column) => includesFolded(column.title, wanted));
          columnIds = new Set(matching.map((column) => column.id));
          if (matching.length === 0) {
            notes.push(
              `No column matches "${wanted}". Columns: ${names.columns.map((c) => c.title).join(', ')}.`,
            );
          }
        }

        let assigneeIds: Set<string | null> | null = null;
        if (args.assignee !== undefined) {
          const wanted = args.assignee;
          if (equalsFolded(wanted, 'me')) assigneeIds = new Set([membership.userId]);
          else if (equalsFolded(wanted, 'unassigned') || equalsFolded(wanted, 'none')) {
            assigneeIds = new Set([null]);
          } else {
            const ids = [...names.memberName].flatMap(([id, name]) =>
              includesFolded(name, wanted) ? [id] : [],
            );
            assigneeIds = new Set(ids);
            if (ids.length === 0) notes.push(`No board member matches "${wanted}".`);
          }
        }

        let labelIds: Set<string> | null = null;
        if (args.label !== undefined) {
          const wanted = args.label;
          const ids = [...names.labelName].flatMap(([id, name]) =>
            equalsFolded(name, wanted) ? [id] : [],
          );
          labelIds = new Set(ids);
          if (ids.length === 0) {
            notes.push(
              `No label is named "${wanted}". Labels: ${[...names.labelName.values()].join(', ') || 'none'}.`,
            );
          }
        }

        const query = args.query;
        const matches = columnCards
          .flatMap((entry) => entry.cards)
          .filter(
            (card) =>
              (columnIds === null || columnIds.has(card.columnId)) &&
              (assigneeIds === null || assigneeIds.has(card.assigneeId)) &&
              (labelIds === null || card.labelIds.some((id) => labelIds.has(id))) &&
              (query === undefined ||
                equalsFolded(card.key, query) ||
                includesFolded(card.title, query) ||
                (card.description !== null && includesFolded(card.description, query))),
          );
        const limit = args.limit ?? AI_SEARCH_CARDS_DEFAULT_LIMIT;
        const shown = matches.slice(0, limit);
        return {
          total: matches.length,
          returned: shown.length,
          truncated: matches.length > shown.length,
          cards: shown.map((card) => describeCard(card, names)),
          ...(notes.length > 0 && { notes }),
        };
      },
    }),

    defineTool({
      name: AI_BOARD_TOOL_NAMES.GET_CARD,
      description:
        'Details of one card of the current board by its key (e.g. SL-12): description, ' +
        'column, assignee, due date, labels and the latest comments.',
      schema: aiGetCardArgsSchema,
      async execute({ key }, { membership }) {
        const parsed = cardKeySchema.safeParse(key);
        const notFound = new NotFoundError(`Card ${key} was not found on this board.`);
        if (!parsed.success) throw notFound;
        let card: Card;
        try {
          card = await cardService.getByKey(membership, parsed.data);
        } catch (err) {
          if (err instanceof NotFoundError) throw notFound;
          throw err;
        }
        const [names, comments] = await Promise.all([
          loadNames(membership),
          commentService.list(membership, card.id, { limit: COMMENTS_READ_LIMIT }),
        ]);
        const column = names.columnById.get(card.columnId);
        const latest = comments.items.slice(-CARD_COMMENTS_SHOWN);
        return {
          ...describeCard(card, names),
          columnCategory: column?.category ?? null,
          description: truncateText(card.description, CARD_DESCRIPTION_MAX_CHARS),
          createdAt: card.createdAt.slice(0, 10),
          updatedAt: card.updatedAt.slice(0, 10),
          commentCount:
            comments.nextCursor === null
              ? comments.items.length
              : `more than ${String(comments.items.length)}`,
          latestComments: latest.map((comment) => ({
            author: comment.author?.name ?? null,
            date: comment.createdAt.slice(0, 10),
            body: truncateText(comment.body, COMMENT_MAX_CHARS),
          })),
        };
      },
    }),

    defineTool({
      name: AI_BOARD_TOOL_NAMES.FLOW_METRICS,
      description:
        'Flow metrics of the current board for the last N days (default 30): throughput, ' +
        'lead and cycle time percentiles in days, current work in progress per column ' +
        "category, Little's law and the oldest cards in progress (aging).",
      schema: aiFlowMetricsArgsSchema,
      async execute({ days = AI_FLOW_METRICS_DEFAULT_DAYS }, { membership, now }) {
        const to = toLocalDateKey(now, TOOL_TIME_ZONE);
        const analytics = await analyticsService.getAnalytics(membership, {
          from: addDays(to, -(days - 1)),
          to,
          timeZone: TOOL_TIME_ZONE,
        });
        const percentiles = (stats: {
          count: number;
          p50: number | null;
          p85: number | null;
          p95: number | null;
        }) => ({
          count: stats.count,
          p50: round1(stats.p50),
          p85: round1(stats.p85),
          p95: round1(stats.p95),
        });
        const completed = analytics.throughput.daily.reduce((sum, day) => sum + day.count, 0);
        const last = analytics.cumulativeFlow.at(-1);
        const { aging, littlesLaw } = analytics;
        return {
          range: { from: analytics.range.from, to: analytics.range.to, days },
          throughput: {
            completed,
            perDay: round1(completed / days),
            weekly: analytics.throughput.weekly.map((week) => ({
              weekStart: week.weekStart,
              count: week.count,
            })),
          },
          leadTimeDays: percentiles(analytics.leadCycle.leadTime),
          cycleTimeDays: percentiles(analytics.leadCycle.cycleTime),
          wipNow: last
            ? {
                backlog: last.BACKLOG,
                todo: last.TODO,
                inProgress: last.IN_PROGRESS,
                done: last.DONE,
              }
            : null,
          littlesLaw: {
            avgWip: round1(littlesLaw.avgWip),
            avgThroughputPerDay: round1(littlesLaw.avgThroughputPerDay),
            avgCycleTimeDays: round1(littlesLaw.avgCycleTimeDays),
          },
          aging: {
            thresholdDays: round1(aging.thresholdDays),
            inProgress: aging.items.length,
            aging: aging.items.filter((item) => item.isAging).length,
            oldest: aging.items.slice(0, AGING_ITEMS_SHOWN).map((item) => ({
              key: item.cardKey,
              title: item.title,
              column: item.columnName,
              assignee: item.assignee?.name ?? null,
              ageDays: round1(item.ageDays),
              isAging: item.isAging,
            })),
          },
        };
      },
    }),

    defineTool({
      name: AI_BOARD_TOOL_NAMES.FORECAST,
      description:
        'Monte Carlo forecast from the daily throughput of the last 30 days. Without arguments ' +
        'or with "remaining": dates by which the remaining cards will be done (50/85/95% ' +
        'confidence). With "targetDate": how many cards will be done by that date.',
      schema: aiForecastArgsSchema,
      async execute({ remaining, targetDate }, { membership }) {
        const query = forecastQuerySchema.parse(
          targetDate === undefined
            ? { mode: 'count', remaining, timeZone: TOOL_TIME_ZONE }
            : { mode: 'date', targetDate, timeZone: TOOL_TIME_ZONE },
        );
        return compactForecast(await analyticsService.forecast(membership, query));
      },
    }),
  ];

  const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  return {
    definitions: tools.map((tool) => tool.definition),
    check(call) {
      const tool = byName.get(call.name);
      if (!tool) {
        return {
          ok: false,
          issues: [
            {
              path: '',
              message: `Unknown tool "${call.name}". Available tools: ${[...byName.keys()].join(', ')}.`,
            },
          ],
        };
      }
      return tool.check(call.argumentsJson);
    },
  };
}

/** The forecast without its full distribution. */
function compactForecast(forecast: ForecastResponse): AiJsonValue {
  const common = {
    startDate: forecast.startDate,
    sample: forecast.sample,
  };
  if (forecast.mode === 'count') {
    const base = { mode: 'when', remaining: forecast.remaining, ...common };
    switch (forecast.status) {
      case 'ok':
        return {
          ...base,
          status: 'ok',
          trials: forecast.trials,
          doneBy: forecast.percentiles,
        };
      case 'insufficient_data':
        return { ...base, status: forecast.status, reason: forecast.reason };
      case 'horizon_exceeded':
        return { ...base, status: forecast.status, maxHorizonDays: forecast.maxHorizonDays };
    }
  }
  const base = { mode: 'how_many', targetDate: forecast.targetDate, ...common };
  switch (forecast.status) {
    case 'ok':
      return {
        ...base,
        status: 'ok',
        days: forecast.days,
        trials: forecast.trials,
        atLeastCards: forecast.percentiles,
      };
    case 'insufficient_data':
      return { ...base, status: forecast.status, reason: forecast.reason };
    case 'horizon_exceeded':
      return { ...base, status: forecast.status, maxHorizonDays: forecast.maxHorizonDays };
  }
}
