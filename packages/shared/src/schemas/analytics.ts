import { z } from 'zod';

import { DEFAULT_TIME_ZONE, daysBetween, isValidTimeZone } from '../flow/dates.js';
import { DEFAULT_SAMPLE_DAYS } from '../flow/throughput.js';
import { userRefSchema } from './user-ref.js';

/**
 * Flow analytics of a board (WF-FLOW-01..06): `GET /boards/:boardId/analytics` and
 * `GET /boards/:boardId/analytics/forecast`. Calendar days are local dates `YYYY-MM-DD` in the
 * requested IANA time zone; instants are ISO 8601 strings.
 */

/** Days of the default analytics range (ending today). */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 30;
/** Largest analytics range in days (both ends inclusive); bounds the cost of a request. */
export const ANALYTICS_MAX_RANGE_DAYS = 366;

/** Largest `remaining` accepted by the "when" forecast. */
export const FORECAST_MAX_REMAINING = 10_000;
export const FORECAST_MIN_SAMPLE_DAYS = 7;
export const FORECAST_MAX_SAMPLE_DAYS = 180;
export const FORECAST_DEFAULT_SAMPLE_DAYS = DEFAULT_SAMPLE_DAYS;
/**
 * Longest forecast the API simulates (days after today): `targetDate` may be at most this far
 * ahead, and a "when" forecast needing more days reports `horizon_exceeded`. Lower than the
 * limit of the simulation itself to bound the CPU time of one request.
 */
export const FORECAST_API_MAX_HORIZON_DAYS = 730;

/** A calendar date `YYYY-MM-DD`. */
export const localDateSchema = z.iso.date('Must be a valid date in YYYY-MM-DD format');

/** An IANA time zone such as `Europe/Warsaw`; `UTC` when absent. */
export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, 'Must be a valid IANA time zone')
  .default(DEFAULT_TIME_ZONE);

/**
 * Query of `GET /boards/:boardId/analytics`. `from` and `to` are inclusive local dates; when
 * absent `to` is today and `from` is `to` minus 29 days. The range must not be inverted and may
 * span at most {@link ANALYTICS_MAX_RANGE_DAYS} days (checked here when both are given, by the
 * server after applying the defaults otherwise). `to` must not be after today in `timeZone`
 * (rejected by the server with a 400 on `to`, never clamped), as only the server knows "today".
 */
export const analyticsQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    timeZone: timeZoneSchema,
  })
  .superRefine(({ from, to }, ctx) => {
    if (from === undefined || to === undefined) return;
    // Malformed dates are already reported by their own schemas.
    if (!localDateSchema.safeParse(from).success || !localDateSchema.safeParse(to).success) return;
    const days = daysBetween(from, to) + 1;
    if (days < 1) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: '`from` must not be after `to`' });
    } else if (days > ANALYTICS_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `The range must not exceed ${String(ANALYTICS_MAX_RANGE_DAYS)} days`,
      });
    }
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const forecastCommonShape = {
  timeZone: timeZoneSchema,
  /** Number of past complete days (ending yesterday) whose throughput is sampled. */
  sampleDays: z.coerce
    .number()
    .int('sampleDays must be an integer')
    .min(
      FORECAST_MIN_SAMPLE_DAYS,
      `sampleDays must be at least ${String(FORECAST_MIN_SAMPLE_DAYS)}`,
    )
    .max(FORECAST_MAX_SAMPLE_DAYS, `sampleDays must be at most ${String(FORECAST_MAX_SAMPLE_DAYS)}`)
    .default(FORECAST_DEFAULT_SAMPLE_DAYS),
};

/**
 * Query of `GET /boards/:boardId/analytics/forecast`:
 * - `mode=count` — "when will `remaining` cards be done?"; `remaining` defaults to the number of
 *   cards currently outside DONE columns,
 * - `mode=date` — "how many cards will be done by `targetDate`?"; the date must be after today
 *   and at most {@link FORECAST_API_MAX_HORIZON_DAYS} days ahead (checked by the server, which knows "today").
 */
export const forecastQuerySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('count'),
    remaining: z.coerce
      .number()
      .int('remaining must be an integer')
      .min(1, 'remaining must be at least 1')
      .max(FORECAST_MAX_REMAINING, `remaining must be at most ${String(FORECAST_MAX_REMAINING)}`)
      .optional(),
    ...forecastCommonShape,
  }),
  z.object({
    mode: z.literal('date'),
    targetDate: localDateSchema,
    ...forecastCommonShape,
  }),
]);

export type ForecastQuery = z.infer<typeof forecastQuerySchema>;

/** 50th, 85th and 95th percentiles; `p85`/`p95` need at least 5 samples, `p50` at least 1. */
export const flowPercentilesSchema = z.object({
  count: z.int().min(0),
  p50: z.number().nullable(),
  p85: z.number().nullable(),
  p95: z.number().nullable(),
});

/** One completed card of the lead/cycle time scatter plot. */
export const leadCyclePointSchema = z.object({
  cardId: z.string(),
  /** `<board key>-<number>`. */
  cardKey: z.string(),
  title: z.string(),
  completedAt: z.iso.datetime(),
  leadTimeDays: z.number(),
  /** `null` when the card was never in progress. */
  cycleTimeDays: z.number().nullable(),
});

export const dailyThroughputSchema = z.object({ date: localDateSchema, count: z.int().min(0) });

/** Completions of an ISO week (Monday-Sunday) that fall inside the range. */
export const weeklyThroughputSchema = z.object({
  weekStart: localDateSchema,
  count: z.int().min(0),
});

/** Number of cards per column category at the end of a local day. */
export const cumulativeFlowPointSchema = z.object({
  date: localDateSchema,
  BACKLOG: z.int().min(0),
  TODO: z.int().min(0),
  IN_PROGRESS: z.int().min(0),
  DONE: z.int().min(0),
  /** Cards whose current column was deleted (category no longer known). */
  unknown: z.int().min(0),
});

/** A card currently in progress. */
export const agingItemSchema = z.object({
  cardId: z.string(),
  cardKey: z.string(),
  title: z.string(),
  columnId: z.string(),
  columnName: z.string(),
  assignee: userRefSchema.nullable(),
  /** First entry into an IN_PROGRESS column. */
  cycleStartedAt: z.iso.datetime(),
  ageDays: z.number().min(0),
  /** Older than `thresholdDays`. */
  isAging: z.boolean(),
});

export const littlesLawSchema = z.object({
  /** Mean end-of-day number of cards in progress over the range. */
  avgWip: z.number(),
  avgThroughputPerDay: z.number(),
  /** Mean cycle time of the cards completed in the range; `null` without such cards. */
  avgCycleTimeDays: z.number().nullable(),
  /** `avgThroughputPerDay * avgCycleTimeDays`. */
  predictedWip: z.number().nullable(),
  /** `(avgWip - predictedWip) / predictedWip`; `null` when `predictedWip` is null or 0. */
  relativeError: z.number().nullable(),
});

/** Response body of `GET /boards/:boardId/analytics`. */
export const analyticsResponseSchema = z.object({
  range: z.object({ from: localDateSchema, to: localDateSchema, timeZone: z.string() }),
  /** Instant the current-state metrics (aging) refer to. */
  generatedAt: z.iso.datetime(),
  /** Cards completed in the range, sorted by completion; percentiles in days. */
  leadCycle: z.object({
    points: z.array(leadCyclePointSchema),
    leadTime: flowPercentilesSchema,
    cycleTime: flowPercentilesSchema,
  }),
  /** Zero-filled for every day / week of the range. */
  throughput: z.object({
    daily: z.array(dailyThroughputSchema),
    weekly: z.array(weeklyThroughputSchema),
  }),
  cumulativeFlow: z.array(cumulativeFlowPointSchema),
  /**
   * Current state, regardless of the range: cards in progress, oldest first. The threshold is
   * the 85th percentile of the cycle times of ALL completed cards of the board (`null` with
   * fewer than 5 of them, in which case no card is aging).
   */
  aging: z.object({
    thresholdDays: z.number().nullable(),
    items: z.array(agingItemSchema),
  }),
  littlesLaw: littlesLawSchema,
});

export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;
export type LeadCycleScatterPoint = z.infer<typeof leadCyclePointSchema>;
export type AgingItem = z.infer<typeof agingItemSchema>;

/** The age of a card in progress, as shown on the board tiles. */
export const cardAgingItemSchema = agingItemSchema.pick({
  cardId: true,
  cycleStartedAt: true,
  ageDays: true,
  isAging: true,
});

/**
 * Response body of `GET /boards/:boardId/analytics/aging`: the current aging work in progress
 * only (no range, no time zone), with the same threshold as the `aging` part of the analytics.
 */
export const agingResponseSchema = z.object({
  /** Instant the ages refer to. */
  generatedAt: z.iso.datetime(),
  thresholdDays: z.number().nullable(),
  /** Cards currently in IN_PROGRESS columns, oldest first. */
  items: z.array(cardAgingItemSchema),
});

export type CardAgingItem = z.infer<typeof cardAgingItemSchema>;
export type AgingResponse = z.infer<typeof agingResponseSchema>;

/** The daily throughput samples a forecast is based on (complete days ending yesterday). */
export const forecastSampleSchema = z.object({
  days: z.int().min(1),
  from: localDateSchema,
  to: localDateSchema,
  totalCompleted: z.int().min(0),
});

const forecastCommon = {
  /** Today in the time zone; simulated days start tomorrow. */
  startDate: localDateSchema,
  timeZone: z.string(),
  sample: forecastSampleSchema,
};

const insufficientDataShape = {
  status: z.literal('insufficient_data'),
  /** No sampled days, or no completion in any of them. */
  reason: z.enum(['no_samples', 'zero_throughput']),
};

const horizonExceededShape = {
  status: z.literal('horizon_exceeded'),
  /** Some trial needed more days than this. */
  maxHorizonDays: z.int(),
};

const whenPointSchema = z.object({ date: localDateSchema, days: z.int().min(0) });

/** "When will `remaining` cards be done?" */
export const forecastCountResponseSchema = z.discriminatedUnion('status', [
  z.object({
    mode: z.literal('count'),
    remaining: z.int().min(0),
    ...forecastCommon,
    status: z.literal('ok'),
    trials: z.int(),
    /** E.g. `p85` = the date by which 85% of the trials finished. */
    percentiles: z.object({ p50: whenPointSchema, p85: whenPointSchema, p95: whenPointSchema }),
    distribution: z.array(
      z.object({
        date: localDateSchema,
        days: z.int().min(0),
        trials: z.int().min(1),
        /** Share of trials finished on or before the date. */
        cumulativeProbability: z.number(),
      }),
    ),
  }),
  z.object({
    mode: z.literal('count'),
    remaining: z.int().min(0),
    ...forecastCommon,
    ...insufficientDataShape,
  }),
  z.object({
    mode: z.literal('count'),
    remaining: z.int().min(0),
    ...forecastCommon,
    ...horizonExceededShape,
  }),
]);

/** "How many cards will be done by `targetDate`?" */
export const forecastDateResponseSchema = z.discriminatedUnion('status', [
  z.object({
    mode: z.literal('date'),
    targetDate: localDateSchema,
    ...forecastCommon,
    status: z.literal('ok'),
    /** Simulated days (tomorrow ... targetDate). */
    days: z.int().min(1),
    trials: z.int(),
    /** "With X% confidence at least N cards" (so `p95 <= p85 <= p50`). */
    percentiles: z.object({ p50: z.int(), p85: z.int(), p95: z.int() }),
    distribution: z.array(
      z.object({
        cards: z.int().min(0),
        trials: z.int().min(1),
        /** Share of trials completing at least `cards` cards. */
        probabilityAtLeast: z.number(),
      }),
    ),
  }),
  z.object({
    mode: z.literal('date'),
    targetDate: localDateSchema,
    ...forecastCommon,
    ...insufficientDataShape,
  }),
  z.object({
    mode: z.literal('date'),
    targetDate: localDateSchema,
    ...forecastCommon,
    ...horizonExceededShape,
  }),
]);

/** Response body of `GET /boards/:boardId/analytics/forecast`; `insufficient_data` is a 200. */
export const forecastResponseSchema = z.union([
  forecastCountResponseSchema,
  forecastDateResponseSchema,
]);

export type ForecastCountResponse = z.infer<typeof forecastCountResponseSchema>;
export type ForecastDateResponse = z.infer<typeof forecastDateResponseSchema>;
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;
