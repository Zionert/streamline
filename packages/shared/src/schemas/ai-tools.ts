import { z } from 'zod';

import { FORECAST_MAX_REMAINING, localDateSchema } from './analytics.js';
import { CARD_KEY_PATTERN } from './card.js';

/**
 * Read-only tools the AI assistant may call in a board chat. Their arguments come from the model
 * and are validated with these (strict) schemas; the board is always the board of the
 * conversation, so no schema has a board field.
 */

export const AI_BOARD_TOOL_NAMES = {
  BOARD_OVERVIEW: 'get_board_overview',
  SEARCH_CARDS: 'search_cards',
  GET_CARD: 'get_card',
  FLOW_METRICS: 'get_flow_metrics',
  FORECAST: 'get_forecast',
} as const;

export type AiBoardToolName = (typeof AI_BOARD_TOOL_NAMES)[keyof typeof AI_BOARD_TOOL_NAMES];

/** Most cards returned by one `search_cards` call. */
export const AI_SEARCH_CARDS_MAX_LIMIT = 50;
export const AI_SEARCH_CARDS_DEFAULT_LIMIT = 30;

export const AI_FLOW_METRICS_MIN_DAYS = 7;
export const AI_FLOW_METRICS_MAX_DAYS = 180;
export const AI_FLOW_METRICS_DEFAULT_DAYS = 30;

const filterText = (max: number) => z.string().trim().min(1).max(max);

/** `get_board_overview`: no arguments. */
export const aiBoardOverviewArgsSchema = z.strictObject({});

/** `search_cards`: every filter is optional; all given filters must match. */
export const aiSearchCardsArgsSchema = z.strictObject({
  query: filterText(200)
    .optional()
    .describe('Text to look for in card titles and descriptions, or a card key such as SL-12'),
  column: filterText(100).optional().describe('Column title (case-insensitive)'),
  assignee: filterText(100)
    .optional()
    .describe('Display name of the assignee, "me" for the current user, or "unassigned"'),
  label: filterText(50).optional().describe('Label name (case-insensitive)'),
  limit: z
    .int()
    .min(1)
    .max(AI_SEARCH_CARDS_MAX_LIMIT)
    .optional()
    .describe(`Most cards to return (default ${String(AI_SEARCH_CARDS_DEFAULT_LIMIT)})`),
});

export type AiSearchCardsArgs = z.infer<typeof aiSearchCardsArgsSchema>;

/** `get_card`: a card of the current board by key (case-insensitive, e.g. `sl-12`). */
export const aiGetCardArgsSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CARD_KEY_PATTERN, 'Card key must look like SL-12')
    .describe('Card key, e.g. SL-12'),
});

export type AiGetCardArgs = z.infer<typeof aiGetCardArgsSchema>;

/** `get_flow_metrics`: metrics of the last `days` days (ending today, UTC). */
export const aiFlowMetricsArgsSchema = z.strictObject({
  days: z
    .int()
    .min(AI_FLOW_METRICS_MIN_DAYS)
    .max(AI_FLOW_METRICS_MAX_DAYS)
    .optional()
    .describe(`Number of past days to analyse (default ${String(AI_FLOW_METRICS_DEFAULT_DAYS)})`),
});

export type AiFlowMetricsArgs = z.infer<typeof aiFlowMetricsArgsSchema>;

/**
 * `get_forecast`: Monte Carlo forecast. With `targetDate`: how many cards will be done by then;
 * otherwise: when `remaining` cards (default: all open cards) will be done.
 */
export const aiForecastArgsSchema = z
  .strictObject({
    remaining: z
      .int()
      .min(1)
      .max(FORECAST_MAX_REMAINING)
      .optional()
      .describe('Number of cards still to finish (default: all cards not in a done column)'),
    targetDate: localDateSchema
      .optional()
      .describe('Date YYYY-MM-DD: forecast how many cards will be done by this date'),
  })
  .refine((args) => args.remaining === undefined || args.targetDate === undefined, {
    message: 'Give either remaining or targetDate, not both',
  });

export type AiForecastArgs = z.infer<typeof aiForecastArgsSchema>;
