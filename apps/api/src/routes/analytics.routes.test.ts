import {
  FORECAST_API_MAX_HORIZON_DAYS,
  addDays,
  analyticsResponseSchema,
  errorResponseSchema,
  forecastResponseSchema,
  mulberry32,
  type AnalyticsResponse,
  type ForecastResponse,
} from '@streamline/shared';
import type { Express } from 'express';
import { pino } from 'pino';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../app.js';
import type { DbClient } from '../repositories/db.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import {
  client,
  columnAt,
  expectStatus,
  seedBoard,
  type Actor,
  type BoardFixture,
  type UserClient,
} from '../test/board-fixture.js';
import { insertFlowCards, type FlowCardSpec } from '../test/flow-fixture.js';
import { createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

/** Tuesday noon UTC; "today" is 2026-11-17 in UTC and in Europe/Warsaw. */
const NOW = new Date('2026-11-17T12:00:00Z');
const TODAY = '2026-11-17';
/** Still Nov 16 in America/Los_Angeles (21:00, UTC-8). */
const EARLY_MORNING = new Date('2026-11-17T05:00:00Z');

let db: DbClient;
let app: Express;
let tokens: TokenService;
let fx: BoardFixture;

beforeAll(() => {
  db = createTestDb();
  const config = createTestConfig();
  app = createApp({
    config,
    logger: pino({ level: 'silent' }),
    db,
    now: () => NOW,
    random: mulberry32(2026),
  });
  tokens = createTokenService(config);
});

beforeEach(async () => {
  await resetDatabase(db);
  fx = await seedBoard(app, db, tokens);
});

afterAll(async () => {
  await db.$disconnect();
});

/** An app over the same database whose clock shows `now`. */
function appAt(now: Date): Express {
  return createApp({
    config: createTestConfig(),
    logger: pino({ level: 'silent' }),
    db,
    now: () => now,
    random: mulberry32(2026),
  });
}

const as = (actor: Actor): UserClient => client(app, fx.users[actor]);
const analyticsPath = (query = '') => `/boards/${fx.boardId}/analytics${query}`;
const forecastPath = (query: string) => `/boards/${fx.boardId}/analytics/forecast${query}`;
const backlog = () => columnAt(fx, 0).id;
const todo = () => columnAt(fx, 1).id;
const inProgress = () => columnAt(fx, 2).id;
const done = () => columnAt(fx, 3).id;

async function getAnalytics(query = '', actor: Actor = 'VIEWER'): Promise<AnalyticsResponse> {
  const response = await as(actor).get(analyticsPath(query));
  expectStatus(response, 200);
  return analyticsResponseSchema.parse(response.body);
}

async function getForecast(query: string): Promise<ForecastResponse> {
  const response = await as('VIEWER').get(forecastPath(query));
  expectStatus(response, 200);
  return forecastResponseSchema.parse(response.body);
}

function cfdOn(result: AnalyticsResponse, date: string) {
  const point = result.cumulativeFlow.find((p) => p.date === date);
  if (!point) throw new Error(`No CFD point for ${date}`);
  return point;
}

const validationIssuesSchema = z.array(
  z.object({ path: z.array(z.union([z.string(), z.number()])) }),
);

/** Paths of the fields reported by a 400 `VALIDATION_ERROR` response. */
function invalidFields(response: Response): string[] {
  const { details } = errorResponseSchema.parse(response.body).error;
  return validationIssuesSchema.parse(details).map((issue) => issue.path.join('.'));
}
const nonZeroDays = (points: readonly { date: string; count: number }[]) =>
  Object.fromEntries(points.filter((p) => p.count > 0).map((p) => [p.date, p.count]));

/** Lead time of F: 2026-11-09T09:00Z -> 2026-11-16T23:30Z. */
const F_DAYS = 7 + 14.5 / 24;

/**
 * A small board with known flow (UTC):
 * - A..F and J completed in the default range (Oct 19 .. Nov 17),
 * - F completed at 23:30 UTC on Nov 16, which is Nov 17 in Warsaw,
 * - G in progress since Oct 27 (aging), H in progress since Nov 15, I in the backlog,
 * - J was created in a column that has been deleted since (unknown category on Nov 11-12).
 */
async function seedKnownFlow() {
  const old = await db.column.create({
    data: { boardId: fx.boardId, title: 'Old', rank: 'zz', category: 'IN_PROGRESS' },
  });
  const specs: FlowCardSpec[] = [
    {
      title: 'A',
      moves: [
        ['2026-11-01T09:00:00Z', todo()],
        ['2026-11-03T09:00:00Z', inProgress()],
        ['2026-11-05T09:00:00Z', done()],
      ],
    },
    {
      title: 'B',
      moves: [
        ['2026-11-02T09:00:00Z', backlog()],
        ['2026-11-04T09:00:00Z', inProgress()],
        ['2026-11-10T09:00:00Z', done()],
      ],
    },
    {
      title: 'C',
      moves: [
        ['2026-11-05T09:00:00Z', inProgress()],
        ['2026-11-06T09:00:00Z', done()],
      ],
    },
    {
      title: 'D',
      moves: [
        ['2026-11-06T09:00:00Z', todo()],
        ['2026-11-09T09:00:00Z', done()],
      ],
    },
    {
      title: 'E',
      moves: [
        ['2026-11-08T09:00:00Z', inProgress()],
        ['2026-11-12T09:00:00Z', done()],
      ],
    },
    {
      title: 'F',
      moves: [
        ['2026-11-09T09:00:00Z', inProgress()],
        ['2026-11-16T23:30:00Z', done()],
      ],
    },
    {
      title: 'G',
      assigneeId: fx.users.MEMBER.id,
      moves: [
        ['2026-10-20T12:00:00Z', todo()],
        ['2026-10-27T12:00:00Z', inProgress()],
      ],
    },
    { title: 'H', moves: [['2026-11-15T12:00:00Z', inProgress()]] },
    { title: 'I', moves: [['2026-11-10T12:00:00Z', backlog()]] },
    {
      title: 'J',
      moves: [
        ['2026-11-11T10:00:00Z', old.id],
        ['2026-11-13T10:00:00Z', done()],
      ],
    },
  ];
  const cards = await insertFlowCards(db, fx.boardId, specs);
  await db.column.delete({ where: { id: old.id } });
  const byTitle = Object.fromEntries(cards.map((card) => [card.title, card]));
  return { cards, byTitle };
}

describe('access', () => {
  it('requires authentication', async () => {
    expectStatus(await request(app).get(analyticsPath()), 401, 'UNAUTHORIZED');
    expectStatus(await request(app).get(forecastPath('?mode=count')), 401, 'UNAUTHORIZED');
  });

  it('hides the board from non-members and unknown boards', async () => {
    expectStatus(await as('OUTSIDER').get(analyticsPath()), 404, 'NOT_FOUND');
    expectStatus(await as('OUTSIDER').get(forecastPath('?mode=count')), 404, 'NOT_FOUND');
    expectStatus(await as('OWNER').get('/boards/nope/analytics'), 404, 'NOT_FOUND');
  });

  it.each(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const)('allows %s', async (actor) => {
    await getAnalytics('', actor);
    expectStatus(await as(actor).get(forecastPath('?mode=count')), 200);
  });
});

describe('GET /analytics query validation', () => {
  it.each([
    ['?timeZone=Mars/Olympus', 'timeZone'],
    ['?from=2026-13-01', 'from'],
    ['?to=yesterday', 'to'],
    ['?from=2026-11-10&to=2026-11-01', 'from'],
    // 367 days.
    ['?from=2025-11-15&to=2026-11-16', 'from'],
    // Only `from`: `to` defaults to today, so the range is checked by the server.
    ['?from=2026-11-18', 'from'],
    ['?from=2025-01-01', 'from'],
    // `to` after today (never clamped), also for a range entirely in the future.
    ['?to=2026-11-18', 'to'],
    ['?from=2026-11-20&to=2026-11-25', 'to'],
    // Already Nov 18 in Kiritimati, but not in Los Angeles.
    ['?to=2026-11-18&timeZone=America/Los_Angeles', 'to'],
  ])('rejects %s', async (query, field) => {
    const response = await as('VIEWER').get(analyticsPath(query));
    expectStatus(response, 400, 'VALIDATION_ERROR');
    expect(invalidFields(response)).toEqual([field]);
  });

  it('accepts a range of exactly 366 days', async () => {
    const result = await getAnalytics('?from=2025-11-16&to=2026-11-16');
    expect(result.throughput.daily).toHaveLength(366);
    expect(result.cumulativeFlow).toHaveLength(366);
  });

  it('defaults to the last 30 days ending today in UTC', async () => {
    const result = await getAnalytics();
    expect(result.range).toEqual({ from: addDays(TODAY, -29), to: TODAY, timeZone: 'UTC' });
    expect(result.generatedAt).toBe(NOW.toISOString());
    expect(result.throughput.daily.map((p) => p.date)).toEqual(
      Array.from({ length: 30 }, (_, i) => addDays(TODAY, i - 29)),
    );
  });

  it('accepts `to` = today in the requested time zone', async () => {
    expect((await getAnalytics(`?to=${TODAY}`)).range).toMatchObject({ to: TODAY });
    // At 12:00 UTC it is already 02:00 on Nov 18 in Kiritimati (UTC+14).
    const kiritimati = await getAnalytics('?to=2026-11-18&timeZone=Pacific/Kiritimati');
    expect(kiritimati.range.to).toBe('2026-11-18');
  });

  it('defaults the range to end on today in the requested time zone', async () => {
    const kiritimati = await getAnalytics('?timeZone=Pacific/Kiritimati');
    expect(kiritimati.range).toEqual({
      from: '2026-10-20',
      to: '2026-11-18',
      timeZone: 'Pacific/Kiritimati',
    });
    // At 05:00 UTC it is still Nov 16 (21:00) in Los Angeles.
    const response = await client(appAt(EARLY_MORNING), fx.users.VIEWER).get(
      analyticsPath('?timeZone=America/Los_Angeles'),
    );
    expectStatus(response, 200);
    expect(analyticsResponseSchema.parse(response.body).range).toMatchObject({
      from: '2026-10-18',
      to: '2026-11-16',
    });
  });

  it('answers a flow error from the metric functions with a 400, not a 500', async () => {
    // An unusable clock makes the flow functions throw `FlowError` (INVALID_ARGUMENT).
    const response = await client(appAt(new Date(Number.NaN)), fx.users.VIEWER).get(
      analyticsPath(),
    );
    expectStatus(response, 400, 'VALIDATION_ERROR');
    expect(errorResponseSchema.parse(response.body).error.message).toBe(
      'Invalid analytics parameters',
    );
  });

  it('defaults `from` to 29 days before a given `to`', async () => {
    const result = await getAnalytics('?to=2026-06-30');
    expect(result.range).toMatchObject({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('returns empty metrics for a board without cards', async () => {
    const result = await getAnalytics();
    expect(result.leadCycle.points).toEqual([]);
    expect(result.leadCycle.leadTime).toEqual({ count: 0, p50: null, p85: null, p95: null });
    expect(result.aging).toEqual({ thresholdDays: null, items: [] });
    expect(result.littlesLaw).toEqual({
      avgWip: 0,
      avgThroughputPerDay: 0,
      avgCycleTimeDays: null,
      predictedWip: null,
      relativeError: null,
    });
  });
});

describe('GET /analytics metrics', () => {
  it('computes lead and cycle times of the cards completed in the range', async () => {
    const { byTitle } = await seedKnownFlow();
    const result = await getAnalytics();

    expect(
      result.leadCycle.points.map(({ title, leadTimeDays, cycleTimeDays }) => [
        title,
        leadTimeDays,
        cycleTimeDays,
      ]),
    ).toEqual([
      ['A', 4, 2],
      ['C', 1, 1],
      ['D', 3, null],
      ['B', 8, 6],
      ['E', 4, 4],
      // The column J started in was deleted, so its cycle start is unknown.
      ['J', 2, null],
      ['F', F_DAYS, F_DAYS],
    ]);
    const a = result.leadCycle.points[0];
    expect(a).toMatchObject({
      cardId: byTitle.A?.id,
      cardKey: `RO-${String(byTitle.A?.number)}`,
      completedAt: '2026-11-05T09:00:00.000Z',
    });
    expect(result.leadCycle.leadTime).toEqual({ count: 7, p50: 4, p85: F_DAYS, p95: 8 });
    expect(result.leadCycle.cycleTime).toEqual({ count: 5, p50: 4, p85: F_DAYS, p95: F_DAYS });
  });

  it('limits lead and cycle times to completions inside the range', async () => {
    await seedKnownFlow();
    const result = await getAnalytics('?from=2026-11-09&to=2026-11-12');
    expect(result.leadCycle.points.map((p) => p.title)).toEqual(['D', 'B', 'E']);
  });

  it('counts throughput per day and per ISO week, zero-filled', async () => {
    await seedKnownFlow();
    const result = await getAnalytics();
    expect(nonZeroDays(result.throughput.daily)).toEqual({
      '2026-11-05': 1,
      '2026-11-06': 1,
      '2026-11-09': 1,
      '2026-11-10': 1,
      '2026-11-12': 1,
      '2026-11-13': 1,
      '2026-11-16': 1,
    });
    expect(result.throughput.weekly).toEqual([
      { weekStart: '2026-10-19', count: 0 },
      { weekStart: '2026-10-26', count: 0 },
      { weekStart: '2026-11-02', count: 2 },
      { weekStart: '2026-11-09', count: 4 },
      { weekStart: '2026-11-16', count: 1 },
    ]);
  });

  it('assigns completions to days in the requested time zone', async () => {
    await seedKnownFlow();
    const warsaw = await getAnalytics('?timeZone=Europe/Warsaw');
    expect(warsaw.range).toEqual({ from: '2026-10-19', to: TODAY, timeZone: 'Europe/Warsaw' });
    const daily = nonZeroDays(warsaw.throughput.daily);
    expect(daily['2026-11-16']).toBeUndefined();
    expect(daily['2026-11-17']).toBe(1);

    const utc = await getAnalytics('?from=2026-11-16&to=2026-11-16');
    expect(utc.leadCycle.points.map((p) => p.title)).toEqual(['F']);
    const warsawDay = await getAnalytics('?from=2026-11-16&to=2026-11-16&timeZone=Europe/Warsaw');
    expect(warsawDay.leadCycle.points).toEqual([]);
  });

  it('builds the cumulative flow, with deleted columns as unknown', async () => {
    await seedKnownFlow();
    const result = await getAnalytics();
    expect(cfdOn(result, '2026-10-19')).toEqual({
      date: '2026-10-19',
      BACKLOG: 0,
      TODO: 0,
      IN_PROGRESS: 0,
      DONE: 0,
      unknown: 0,
    });
    expect(cfdOn(result, '2026-10-20')).toMatchObject({ TODO: 1, IN_PROGRESS: 0 });
    expect(cfdOn(result, '2026-11-12')).toEqual({
      date: '2026-11-12',
      BACKLOG: 1,
      TODO: 0,
      IN_PROGRESS: 2,
      DONE: 5,
      unknown: 1,
    });
    expect(cfdOn(result, TODAY)).toEqual({
      date: TODAY,
      BACKLOG: 1,
      TODO: 0,
      IN_PROGRESS: 2,
      DONE: 7,
      unknown: 0,
    });
  });

  it('flags cards in progress longer than the 85th percentile of all cycle times', async () => {
    const { byTitle } = await seedKnownFlow();
    // Completed long before the range: still part of the threshold sample.
    await insertFlowCards(db, fx.boardId, [
      {
        title: 'Old work',
        moves: [
          ['2026-01-01T00:00:00Z', inProgress()],
          ['2026-01-21T00:00:00Z', done()],
        ],
      },
    ]);
    const result = await getAnalytics();
    // Samples 1, 2, 4, 6, F and 20: the 85th percentile (rank 6 of 6) is the old card's 20 days.
    expect(result.aging.thresholdDays).toBe(20);
    expect(result.aging.items).toEqual([
      {
        cardId: byTitle.G?.id,
        cardKey: `RO-${String(byTitle.G?.number)}`,
        title: 'G',
        columnId: inProgress(),
        columnName: 'In Progress',
        assignee: { id: fx.users.MEMBER.id, name: fx.users.MEMBER.name },
        cycleStartedAt: '2026-10-27T12:00:00.000Z',
        ageDays: 21,
        isAging: true,
      },
      {
        cardId: byTitle.H?.id,
        cardKey: `RO-${String(byTitle.H?.number)}`,
        title: 'H',
        columnId: inProgress(),
        columnName: 'In Progress',
        assignee: null,
        cycleStartedAt: '2026-11-15T12:00:00.000Z',
        ageDays: 2,
        isAging: false,
      },
    ]);
  });

  it("checks Little's law over the range", async () => {
    await seedKnownFlow();
    const result = await getAnalytics();
    const avgWip =
      result.cumulativeFlow.reduce((sum, point) => sum + point.IN_PROGRESS, 0) /
      result.cumulativeFlow.length;
    const avgCycle = (2 + 6 + 1 + 4 + F_DAYS) / 5;
    const predicted = (7 / 30) * avgCycle;
    expect(result.littlesLaw.avgWip).toBeCloseTo(avgWip, 12);
    expect(result.littlesLaw.avgThroughputPerDay).toBeCloseTo(7 / 30, 12);
    expect(result.littlesLaw.avgCycleTimeDays).toBeCloseTo(avgCycle, 12);
    expect(result.littlesLaw.predictedWip).toBeCloseTo(predicted, 12);
    expect(result.littlesLaw.relativeError).toBeCloseTo((avgWip - predicted) / predicted, 12);
  });

  it('uses the current category of a column', async () => {
    await seedKnownFlow();
    // Turning "In Progress" into a TODO column moves G and H out of aging work.
    await db.column.update({ where: { id: inProgress() }, data: { category: 'TODO' } });
    const result = await getAnalytics();
    expect(result.aging.items).toEqual([]);
    expect(cfdOn(result, TODAY)).toMatchObject({ TODO: 2, IN_PROGRESS: 0 });
  });
});

describe('GET /analytics/forecast', () => {
  /** One card completed on each of the `days` days before today, plus `open` cards in To Do. */
  async function seedConstantThroughput(days: number, open: number): Promise<void> {
    const specs: FlowCardSpec[] = [];
    for (let i = 1; i <= days; i++) {
      const day = addDays(TODAY, -i);
      specs.push({
        moves: [
          [`${addDays(day, -2)}T10:00:00Z`, inProgress()],
          [`${day}T10:00:00Z`, done()],
        ],
      });
    }
    for (let i = 0; i < open; i++) {
      specs.push({ moves: [['2026-11-01T10:00:00Z', todo()]] });
    }
    // Completed today: not part of the samples (today is not a complete day).
    specs.push({
      moves: [
        ['2026-11-16T10:00:00Z', inProgress()],
        ['2026-11-17T08:00:00Z', done()],
      ],
    });
    await insertFlowCards(db, fx.boardId, specs);
  }

  describe('query validation', () => {
    it.each([
      ['', 'mode'],
      ['?mode=soon', 'mode'],
      ['?mode=count&remaining=0', 'remaining'],
      ['?mode=count&remaining=10001', 'remaining'],
      ['?mode=count&remaining=2.5', 'remaining'],
      ['?mode=count&sampleDays=6', 'sampleDays'],
      ['?mode=count&sampleDays=181', 'sampleDays'],
      ['?mode=count&timeZone=Nowhere/City', 'timeZone'],
      ['?mode=date', 'targetDate'],
      ['?mode=date&targetDate=2026-02-30', 'targetDate'],
      [`?mode=date&targetDate=${TODAY}`, 'targetDate'],
      ['?mode=date&targetDate=2026-11-01', 'targetDate'],
      [`?mode=date&targetDate=${addDays(TODAY, FORECAST_API_MAX_HORIZON_DAYS + 1)}`, 'targetDate'],
    ])('rejects %j', async (query, field) => {
      const response = await as('VIEWER').get(forecastPath(query));
      expectStatus(response, 400, 'VALIDATION_ERROR');
      expect(invalidFields(response)).toEqual([field]);
    });

    it('accepts a targetDate at the horizon', async () => {
      await seedConstantThroughput(30, 0);
      const result = await getForecast(
        `?mode=date&targetDate=${addDays(TODAY, FORECAST_API_MAX_HORIZON_DAYS)}`,
      );
      expect(result).toMatchObject({ status: 'ok', days: FORECAST_API_MAX_HORIZON_DAYS });
    });
  });

  it('answers "when" exactly for a constant throughput', async () => {
    await seedConstantThroughput(30, 5);
    const result = await getForecast('?mode=count');
    expect(result).toEqual({
      mode: 'count',
      remaining: 5,
      startDate: TODAY,
      timeZone: 'UTC',
      sample: { days: 30, from: addDays(TODAY, -30), to: addDays(TODAY, -1), totalCompleted: 30 },
      status: 'ok',
      trials: 10_000,
      percentiles: {
        p50: { date: '2026-11-22', days: 5 },
        p85: { date: '2026-11-22', days: 5 },
        p95: { date: '2026-11-22', days: 5 },
      },
      distribution: [{ date: '2026-11-22', days: 5, trials: 10_000, cumulativeProbability: 1 }],
    });

    const explicit = await getForecast('?mode=count&remaining=12&sampleDays=7');
    expect(explicit).toMatchObject({
      remaining: 12,
      sample: { days: 7, from: addDays(TODAY, -7), to: addDays(TODAY, -1), totalCompleted: 7 },
      percentiles: { p95: { date: '2026-11-29', days: 12 } },
    });
  });

  it('answers "how many" exactly for a constant throughput', async () => {
    await seedConstantThroughput(30, 5);
    const result = await getForecast('?mode=date&targetDate=2026-11-27');
    expect(result).toEqual({
      mode: 'date',
      targetDate: '2026-11-27',
      startDate: TODAY,
      timeZone: 'UTC',
      sample: { days: 30, from: addDays(TODAY, -30), to: addDays(TODAY, -1), totalCompleted: 30 },
      status: 'ok',
      days: 10,
      trials: 10_000,
      percentiles: { p50: 10, p85: 10, p95: 10 },
      distribution: [{ cards: 10, trials: 10_000, probabilityAtLeast: 1 }],
    });
  });

  it('is reproducible with a seeded random source', async () => {
    // Alternating throughput 0 / 2 gives a spread of outcomes.
    const specs: FlowCardSpec[] = [];
    for (let i = 1; i <= 30; i += 2) {
      const day = addDays(TODAY, -i);
      for (let k = 0; k < 2; k++) {
        specs.push({
          moves: [
            [`${addDays(day, -1)}T10:00:00Z`, inProgress()],
            [`${day}T1${String(k)}:00:00Z`, done()],
          ],
        });
      }
    }
    await insertFlowCards(db, fx.boardId, specs);
    const seeded = () =>
      createApp({
        config: createTestConfig(),
        logger: pino({ level: 'silent' }),
        db,
        now: () => NOW,
        random: mulberry32(7),
      });
    const path = forecastPath('?mode=date&targetDate=2026-12-17');
    const first = await client(seeded(), fx.users.VIEWER).get(path);
    const second = await client(seeded(), fx.users.VIEWER).get(path);
    expectStatus(first, 200);
    expect(second.body).toEqual(first.body);
    const parsed = forecastResponseSchema.parse(first.body);
    if (parsed.status !== 'ok' || parsed.mode !== 'date') throw new Error('Expected a result');
    expect(parsed.percentiles.p95).toBeLessThan(parsed.percentiles.p50);
    expect(parsed.distribution.length).toBeGreaterThan(1);
  });

  it('counts the cards outside DONE columns as remaining by default', async () => {
    await seedKnownFlow();
    // G, H (in progress) and I (backlog); J's deleted column does not matter, it is done now.
    const result = await getForecast('?mode=count');
    expect(result).toMatchObject({ mode: 'count', remaining: 3 });
  });

  it('reports insufficient data without completions as a 200', async () => {
    await insertFlowCards(db, fx.boardId, [{ moves: [['2026-11-01T10:00:00Z', todo()]] }]);
    expect(await getForecast('?mode=count')).toEqual({
      mode: 'count',
      remaining: 1,
      startDate: TODAY,
      timeZone: 'UTC',
      sample: { days: 30, from: addDays(TODAY, -30), to: addDays(TODAY, -1), totalCompleted: 0 },
      status: 'insufficient_data',
      reason: 'zero_throughput',
    });
    expect(await getForecast('?mode=date&targetDate=2026-12-01')).toMatchObject({
      mode: 'date',
      status: 'insufficient_data',
      reason: 'zero_throughput',
    });
  });

  it('reports a forecast beyond the horizon', async () => {
    // One completion in 180 days cannot finish 10 000 cards within the horizon.
    await insertFlowCards(db, fx.boardId, [
      {
        moves: [
          ['2026-11-01T10:00:00Z', inProgress()],
          ['2026-11-02T10:00:00Z', done()],
        ],
      },
    ]);
    expect(await getForecast('?mode=count&remaining=10000&sampleDays=180')).toMatchObject({
      status: 'horizon_exceeded',
      maxHorizonDays: FORECAST_API_MAX_HORIZON_DAYS,
    });
  });

  it('stops a "when" forecast at the horizon of the API', async () => {
    // Exactly one card a day: N cards take N days.
    await seedConstantThroughput(30, 0);
    expect(
      await getForecast(`?mode=count&remaining=${String(FORECAST_API_MAX_HORIZON_DAYS)}`),
    ).toMatchObject({
      status: 'ok',
      percentiles: { p95: { days: FORECAST_API_MAX_HORIZON_DAYS } },
    });
    expect(
      await getForecast(`?mode=count&remaining=${String(FORECAST_API_MAX_HORIZON_DAYS + 1)}`),
    ).toMatchObject({
      status: 'horizon_exceeded',
      maxHorizonDays: FORECAST_API_MAX_HORIZON_DAYS,
    });
  });

  it('samples complete days ending yesterday in the requested time zone', async () => {
    await seedConstantThroughput(30, 1);
    // In Tokyo it is 21:00 on Nov 17, the same "today" as in UTC.
    const tokyo = await getForecast('?mode=count&timeZone=Asia/Tokyo');
    expect(tokyo).toMatchObject({
      startDate: TODAY,
      timeZone: 'Asia/Tokyo',
      sample: { from: addDays(TODAY, -30), to: addDays(TODAY, -1) },
    });
    // At UTC-12 it is exactly 00:00 on Nov 17.
    const pacific = await getForecast('?mode=count&timeZone=Etc/GMT%2B12');
    expect(pacific).toMatchObject({ startDate: TODAY, sample: { to: addDays(TODAY, -1) } });
  });

  it('starts tomorrow in a time zone where it is already the next day', async () => {
    await seedConstantThroughput(30, 1);
    // 02:00 on Nov 18 in Kiritimati (UTC+14): Nov 17 is complete, so it is the last sample.
    // The daily completions at 10:00 UTC fall on 00:00 local of the next day (Oct 19 .. Nov 17)
    // and the card completed at 08:00 UTC on Nov 17 (22:00 local) is sampled as well.
    expect(await getForecast('?mode=count&timeZone=Pacific/Kiritimati')).toMatchObject({
      startDate: '2026-11-18',
      timeZone: 'Pacific/Kiritimati',
      sample: { days: 30, from: '2026-10-19', to: '2026-11-17', totalCompleted: 31 },
    });
    // The same card is today's (incomplete) work in UTC and not sampled there.
    expect(await getForecast('?mode=count')).toMatchObject({ sample: { totalCompleted: 30 } });
  });

  it('starts on the previous day in a time zone where it is still yesterday', async () => {
    await seedConstantThroughput(30, 1);
    // 05:00 UTC on Nov 17 is 21:00 on Nov 16 in Los Angeles.
    const response = await client(appAt(EARLY_MORNING), fx.users.VIEWER).get(
      forecastPath('?mode=count&timeZone=America/Los_Angeles'),
    );
    expectStatus(response, 200);
    expect(forecastResponseSchema.parse(response.body)).toMatchObject({
      startDate: '2026-11-16',
      sample: { from: '2026-10-17', to: '2026-11-15' },
    });
  });
});
