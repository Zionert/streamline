import {
  ANALYTICS_DEFAULT_RANGE_DAYS,
  ANALYTICS_MAX_RANGE_DAYS,
  FlowError,
  FORECAST_API_MAX_HORIZON_DAYS,
  addDays,
  agingWip,
  cumulativeFlow,
  dailyThroughputSamples,
  daysBetween,
  deriveCardFlow,
  forecastHowMany,
  forecastWhen,
  formatCardKey,
  instantOnLocalDate,
  leadCycleStats,
  littlesLaw,
  throughput,
  toLocalDateKey,
  type AnalyticsQuery,
  type AnalyticsResponse,
  type CardFlow,
  type ColumnCategory,
  type ForecastQuery,
  type ForecastResponse,
  type FlowTransitionInput,
  type LocalDateKey,
  type RandomSource,
} from '@streamline/shared';

import { NotFoundError, ValidationError } from '../errors/app-error.js';
import type {
  AnalyticsRepository,
  BoardFlowData,
  FlowCardRecord,
  FlowColumnRecord,
} from '../repositories/analytics.repository.js';
import {
  assertBoardPermission,
  BOARD_NOT_FOUND_MESSAGE,
  type BoardMembership,
} from './board-access.service.js';

/**
 * Flow analytics of a board (WF-FLOW-01..06), computed on request from the board's card
 * transitions with the metric functions of `@streamline/shared`. Transitions are mapped to the
 * CURRENT category of their target column (a deleted column gives an unknown category), so
 * changing a column's category changes past results as well.
 */
export interface AnalyticsService {
  /**
   * Range metrics (lead/cycle time, throughput, cumulative flow, Little's law) for the local days
   * of the query, plus the current aging work in progress.
   */
  getAnalytics(membership: BoardMembership, query: AnalyticsQuery): Promise<AnalyticsResponse>;
  /** Monte Carlo forecast from the daily throughput of the last complete days. */
  forecast(membership: BoardMembership, query: ForecastQuery): Promise<ForecastResponse>;
}

export interface AnalyticsServiceDependencies {
  analytics: AnalyticsRepository;
  /** Current time; "today" and the age of cards in progress depend on it. */
  now?: () => Date;
  /** Random source of the Monte Carlo simulation, `Math.random` by default. */
  random?: RandomSource;
}

/** The validation failure of one query field, shaped like the issues of a Zod error. */
function invalidField(field: string, message: string): ValidationError {
  return new ValidationError('Validation failed', [{ code: 'custom', path: [field], message }]);
}

/** An instant on the local day `key`; a day that does not exist in the zone is a bad request. */
function localDay(key: LocalDateKey, timeZone: string, field: string): Date {
  try {
    return instantOnLocalDate(key, timeZone);
  } catch (err) {
    if (err instanceof FlowError) throw invalidField(field, err.message);
    throw err;
  }
}

interface BoardFlows {
  data: BoardFlowData;
  /** Derived once per request and passed to every metric (they reuse derived flows). */
  flows: CardFlow[];
  flowById: Map<string, CardFlow>;
  cardById: Map<string, FlowCardRecord>;
  columnById: Map<string, FlowColumnRecord>;
}

function deriveBoardFlows(data: BoardFlowData): BoardFlows {
  const columnById = new Map(data.columns.map((column) => [column.id, column]));
  const categoryOf = (columnId: string | null): ColumnCategory | null =>
    columnId === null ? null : (columnById.get(columnId)?.category ?? null);

  const transitionsByCard = new Map<string, FlowTransitionInput[]>();
  for (const transition of data.transitions) {
    let list = transitionsByCard.get(transition.cardId);
    if (!list) {
      list = [];
      transitionsByCard.set(transition.cardId, list);
    }
    list.push({ at: transition.movedAt, toCategory: categoryOf(transition.toColumnId) });
  }

  const flows = data.cards.map((card) =>
    deriveCardFlow({
      cardId: card.id,
      createdAt: card.createdAt,
      transitions: transitionsByCard.get(card.id) ?? [],
    }),
  );
  return {
    data,
    flows,
    flowById: new Map(flows.map((flow) => [flow.cardId, flow])),
    cardById: new Map(data.cards.map((card) => [card.id, card])),
    columnById,
  };
}

/** Resolves the defaults of the analytics range and checks it (also when only `from` is given). */
function resolveRange(
  query: AnalyticsQuery,
  todayKey: LocalDateKey,
): { fromKey: LocalDateKey; toKey: LocalDateKey } {
  const toKey = query.to ?? todayKey;
  // Days after today have no data yet; a future `to` would only pad the charts with zeros.
  if (toKey > todayKey) throw invalidField('to', '`to` must not be after today');
  const fromKey = query.from ?? addDays(toKey, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  const days = daysBetween(fromKey, toKey) + 1;
  if (days < 1) throw invalidField('from', '`from` must not be after `to`');
  if (days > ANALYTICS_MAX_RANGE_DAYS) {
    throw invalidField(
      'from',
      `The range must not exceed ${String(ANALYTICS_MAX_RANGE_DAYS)} days`,
    );
  }
  return { fromKey, toKey };
}

/**
 * The instant of the "how many" forecast's last day: after today (today is never simulated) and
 * within the horizon of the API.
 */
function resolveTargetDate(
  targetKey: LocalDateKey,
  todayKey: LocalDateKey,
  timeZone: string,
): Date {
  const days = daysBetween(todayKey, targetKey);
  if (days < 1) throw invalidField('targetDate', 'targetDate must be after today');
  if (days > FORECAST_API_MAX_HORIZON_DAYS) {
    throw invalidField(
      'targetDate',
      `targetDate must be at most ${String(FORECAST_API_MAX_HORIZON_DAYS)} days after today`,
    );
  }
  return localDay(targetKey, timeZone, 'targetDate');
}

export function createAnalyticsService({
  analytics,
  now = () => new Date(),
  random = Math.random,
}: AnalyticsServiceDependencies): AnalyticsService {
  async function load(boardId: string): Promise<BoardFlows> {
    const data = await analytics.loadBoardFlow(boardId);
    if (!data) throw new NotFoundError(BOARD_NOT_FOUND_MESSAGE);
    return deriveBoardFlows(data);
  }

  return {
    async getAnalytics(membership, query) {
      assertBoardPermission(membership, 'board:view');
      const { timeZone } = query;
      const generatedAt = now();
      const { fromKey, toKey } = resolveRange(query, toLocalDateKey(generatedAt, timeZone));
      const from = localDay(fromKey, timeZone, 'from');
      const to = localDay(toKey, timeZone, 'to');

      const { data, flows, flowById, cardById, columnById } = await load(membership.boardId);
      const keyOf = (card: FlowCardRecord | undefined) =>
        card ? formatCardKey(data.boardKey, card.number) : '';
      const range = { from, to, timeZone };

      const leadCycle = leadCycleStats(flows, range);
      // The threshold uses the cycle times of all completed cards, not only those of the range:
      // aging is a statement about the current work, and a short range would give a noisy p85.
      const aging = agingWip(flows, { now: generatedAt });
      const law = littlesLaw(flows, range);

      return {
        range: { from: fromKey, to: toKey, timeZone },
        generatedAt: generatedAt.toISOString(),
        leadCycle: {
          points: leadCycle.points.map((point) => {
            const card = cardById.get(point.cardId);
            return {
              cardId: point.cardId,
              cardKey: keyOf(card),
              title: card?.title ?? '',
              completedAt: point.completedAt.toISOString(),
              leadTimeDays: point.leadTimeDays,
              cycleTimeDays: point.cycleTimeDays,
            };
          }),
          leadTime: leadCycle.leadTime,
          cycleTime: leadCycle.cycleTime,
        },
        throughput: {
          daily: throughput(flows, { ...range, granularity: 'day' }),
          weekly: throughput(flows, { ...range, granularity: 'week' }).map(({ date, count }) => ({
            weekStart: date,
            count,
          })),
        },
        cumulativeFlow: cumulativeFlow(flows, range),
        aging: {
          thresholdDays: aging.thresholdDays,
          items: aging.items.flatMap((item) => {
            const card = cardById.get(item.cardId);
            const cycleStartedAt = flowById.get(item.cardId)?.cycleStartedAt;
            if (!card || !cycleStartedAt) return [];
            return [
              {
                cardId: card.id,
                cardKey: keyOf(card),
                title: card.title,
                columnId: card.columnId,
                columnName: columnById.get(card.columnId)?.title ?? '',
                assignee: card.assignee,
                cycleStartedAt: cycleStartedAt.toISOString(),
                ageDays: item.ageDays,
                isAging: item.isAging,
              },
            ];
          }),
        },
        littlesLaw: {
          avgWip: law.avgWip,
          avgThroughputPerDay: law.avgThroughputPerDay,
          avgCycleTimeDays: law.avgCycleTimeDays,
          predictedWip: law.predictedWip,
          relativeError: law.relativeError,
        },
      };
    },

    async forecast(membership, query) {
      assertBoardPermission(membership, 'board:view');
      const { timeZone, sampleDays } = query;
      const startDate = now();
      const todayKey = toLocalDateKey(startDate, timeZone);
      // Samples cover complete days only: the last one is yesterday.
      const lastSampleKey = addDays(todayKey, -1);
      const lastSampleDay = localDay(lastSampleKey, timeZone, 'timeZone');

      const loadSamples = async () => {
        const { data, flows, columnById } = await load(membership.boardId);
        const samples = dailyThroughputSamples(flows, {
          endDate: lastSampleDay,
          days: sampleDays,
          timeZone,
        });
        const openCards = data.cards.filter(
          (card) => columnById.get(card.columnId)?.category !== 'DONE',
        ).length;
        const common = {
          startDate: todayKey,
          timeZone,
          sample: {
            days: sampleDays,
            from: addDays(lastSampleKey, -(sampleDays - 1)),
            to: lastSampleKey,
            totalCompleted: samples.reduce((sum, count) => sum + count, 0),
          },
        };
        return { samples, openCards, common };
      };

      if (query.mode === 'date') {
        const targetDate = resolveTargetDate(query.targetDate, todayKey, timeZone);
        const { samples, common } = await loadSamples();
        const result = forecastHowMany({
          samples,
          startDate,
          timeZone,
          targetDate,
          random,
          maxHorizonDays: FORECAST_API_MAX_HORIZON_DAYS,
        });
        const base = { mode: query.mode, targetDate: query.targetDate, ...common };
        return result.status === 'ok'
          ? {
              ...base,
              status: result.status,
              days: result.days,
              trials: result.trials,
              percentiles: result.percentiles,
              distribution: result.distribution,
            }
          : { ...base, ...result };
      }

      const { samples, openCards, common } = await loadSamples();
      const remaining = query.remaining ?? openCards;
      const result = forecastWhen({
        samples,
        startDate,
        timeZone,
        remaining,
        random,
        maxHorizonDays: FORECAST_API_MAX_HORIZON_DAYS,
      });
      const base = { mode: query.mode, remaining, ...common };
      return result.status === 'ok'
        ? {
            ...base,
            status: result.status,
            trials: result.trials,
            percentiles: result.percentiles,
            distribution: result.distribution,
          }
        : { ...base, ...result };
    },
  };
}
