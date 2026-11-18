import { performance } from 'node:perf_hooks';

import {
  FORECAST_API_MAX_HORIZON_DAYS,
  FORECAST_MAX_REMAINING,
  addDays,
  agingResponseSchema,
  analyticsResponseSchema,
  forecastResponseSchema,
  mulberry32,
} from '@streamline/shared';
import type { Express } from 'express';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { DbClient } from '../repositories/db.js';
import { createTokenService } from '../services/token.service.js';
import {
  client,
  columnAt,
  expectStatus,
  seedBoard,
  type BoardFixture,
} from '../test/board-fixture.js';
import { insertFlowCards, type FlowCardSpec, type FlowMove } from '../test/flow-fixture.js';
import { createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const TODAY = '2026-11-17';
const CARD_COUNT = 1000;
/** Upper bound of one request (server round trip), in milliseconds. */
const MAX_DURATION_MS = 1000;
const HOUR_MS = 3_600_000;

let db: DbClient;
let app: Express;
let fx: BoardFixture;

/**
 * 1000 cards created over the last ~400 days, each moving Backlog/To Do -> In Progress -> Done
 * with occasional reopening; about a fifth are still open. 3-5 transitions per card.
 */
function boardHistory(): FlowCardSpec[] {
  const random = mulberry32(1000);
  const between = (min: number, max: number) => min + random() * (max - min);
  const [backlog, todo, inProgress, done] = [0, 1, 2, 3].map((i) => columnAt(fx, i).id);
  if (!backlog || !todo || !inProgress || !done) throw new Error('Expected default columns');

  const specs: FlowCardSpec[] = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    let at = NOW.getTime() - between(1, 400) * 24 * HOUR_MS;
    const moves: FlowMove[] = [];
    const move = (columnId: string, afterHours: number): boolean => {
      at += afterHours * HOUR_MS;
      if (at >= NOW.getTime()) return false;
      moves.push([new Date(at), columnId]);
      return true;
    };
    move(random() < 0.7 ? backlog : todo, 0);
    const reopened = random() < 0.1;
    if (
      move(todo, between(2, 120)) &&
      move(inProgress, between(2, 72)) &&
      move(done, between(4, 200)) &&
      reopened &&
      move(inProgress, between(4, 48))
    ) {
      move(done, between(4, 72));
    }
    specs.push({ title: `Card ${String(i + 1)}`, moves });
  }
  return specs;
}

beforeAll(async () => {
  db = createTestDb();
  const config = createTestConfig();
  app = createApp({
    config,
    logger: pino({ level: 'silent' }),
    db,
    now: () => NOW,
    random: mulberry32(1),
  });
  await resetDatabase(db);
  fx = await seedBoard(app, db, createTokenService(config));
  await insertFlowCards(db, fx.boardId, boardHistory());
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

/** Duration of the request in ms, after one warm-up request. */
async function timed(path: string, parse: (body: unknown) => unknown): Promise<number> {
  const viewer = client(app, fx.users.VIEWER);
  expectStatus(await viewer.get(path), 200);
  const started = performance.now();
  const response = await viewer.get(path);
  const duration = performance.now() - started;
  expectStatus(response, 200);
  parse(response.body);
  console.info(`${path.replace(fx.boardId, ':boardId')}: ${duration.toFixed(1)} ms`);
  return duration;
}

describe(`analytics of a board with ${String(CARD_COUNT)} cards`, () => {
  it('has realistic history', async () => {
    const transitions = await db.cardTransition.count({ where: { boardId: fx.boardId } });
    expect(transitions / CARD_COUNT).toBeGreaterThanOrEqual(3);
    expect(transitions / CARD_COUNT).toBeLessThanOrEqual(5);
  });

  it.each([
    ['the default range', ''],
    ['a 366-day range', `?from=${addDays(TODAY, -365)}&to=${TODAY}&timeZone=Europe/Warsaw`],
  ])(`GET /analytics for %s takes less than ${String(MAX_DURATION_MS)} ms`, async (_, query) => {
    const duration = await timed(`/boards/${fx.boardId}/analytics${query}`, (body) =>
      analyticsResponseSchema.parse(body),
    );
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });

  it(`GET /analytics/aging takes less than ${String(MAX_DURATION_MS)} ms`, async () => {
    const duration = await timed(`/boards/${fx.boardId}/analytics/aging`, (body) => {
      expect(agingResponseSchema.parse(body).items.length).toBeGreaterThan(0);
    });
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });

  it.each([
    ['count', '?mode=count'],
    ['date', `?mode=date&targetDate=${addDays(TODAY, 90)}&sampleDays=180`],
  ])(
    `GET /analytics/forecast in %s mode takes less than ${String(MAX_DURATION_MS)} ms`,
    async (_, query) => {
      const duration = await timed(`/boards/${fx.boardId}/analytics/forecast${query}`, (body) => {
        expect(forecastResponseSchema.parse(body)).toMatchObject({ status: 'ok' });
      });
      expect(duration).toBeLessThan(MAX_DURATION_MS);
    },
  );
});

describe(`worst-case forecasts (horizon ${String(FORECAST_API_MAX_HORIZON_DAYS)} days)`, () => {
  const forecastPath = (query: string) => `/boards/${fx.boardId}/analytics/forecast${query}`;

  it(`"how many" up to the horizon takes less than ${String(MAX_DURATION_MS)} ms`, async () => {
    const target = addDays(TODAY, FORECAST_API_MAX_HORIZON_DAYS);
    const duration = await timed(forecastPath(`?mode=date&targetDate=${target}`), (body) => {
      expect(forecastResponseSchema.parse(body)).toMatchObject({
        status: 'ok',
        days: FORECAST_API_MAX_HORIZON_DAYS,
      });
    });
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });

  it(`"when" finishing just before the horizon takes less than ${String(MAX_DURATION_MS)} ms`, async () => {
    // Every trial simulates close to the horizon: ~90% of it at the sampled mean throughput.
    const probe = forecastResponseSchema.parse(
      (await client(app, fx.users.VIEWER).get(forecastPath('?mode=count&sampleDays=180'))).body,
    );
    const perDay = probe.sample.totalCompleted / probe.sample.days;
    const remaining = Math.min(
      FORECAST_MAX_REMAINING,
      Math.floor(perDay * FORECAST_API_MAX_HORIZON_DAYS * 0.9),
    );
    const duration = await timed(
      forecastPath(`?mode=count&sampleDays=180&remaining=${String(remaining)}`),
      (body) => {
        expect(['ok', 'horizon_exceeded']).toContain(forecastResponseSchema.parse(body).status);
      },
    );
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });

  it(`"when" for ${String(FORECAST_MAX_REMAINING)} cards takes less than ${String(MAX_DURATION_MS)} ms`, async () => {
    const query = `?mode=count&sampleDays=180&remaining=${String(FORECAST_MAX_REMAINING)}`;
    const duration = await timed(forecastPath(query), (body) => {
      expect(forecastResponseSchema.parse(body)).toMatchObject({
        status: 'horizon_exceeded',
        maxHorizonDays: FORECAST_API_MAX_HORIZON_DAYS,
      });
    });
    expect(duration).toBeLessThan(MAX_DURATION_MS);
  });
});
