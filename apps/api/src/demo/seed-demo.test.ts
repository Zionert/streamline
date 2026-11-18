import {
  addDays,
  analyticsResponseSchema,
  forecastResponseSchema,
  mulberry32,
  type ColumnCategory,
} from '@streamline/shared';
import { compare } from 'bcryptjs';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { DbClient } from '../repositories/db.js';
import { createTokenService, type TokenService } from '../services/token.service.js';
import { createTestConfig, createTestDb, resetDatabase } from '../test/helpers.js';
import { DEMO_HISTORY_DAYS, DEMO_USER_EMAIL, DEMO_USERS, buildDemoPlan } from './demo-plan.js';
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_RANDOM_SEED,
  assertDemoSeedAllowed,
  seedDemo,
  type SeedDemoResult,
} from './seed-demo.js';

/** A Wednesday afternoon. */
const NOW = new Date('2026-11-18T15:30:00Z');
const TODAY = '2026-11-18';

let db: DbClient;
let app: Express;
let tokens: TokenService;

beforeAll(() => {
  db = createTestDb();
  const config = createTestConfig();
  app = createApp({
    config,
    logger: pino({ level: 'silent' }),
    db,
    now: () => NOW,
    random: mulberry32(1),
  });
  tokens = createTokenService(config);
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const seed = (password?: string): Promise<SeedDemoResult> =>
  seedDemo(db, { now: NOW, bcryptCost: 4, ...(password !== undefined && { password }) });

async function asDemo(result: SeedDemoResult, path: string) {
  const token = await tokens.signAccessToken(result.userIds.demo);
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

describe('assertDemoSeedAllowed', () => {
  it('refuses production and allows the other environments', () => {
    expect(() => {
      assertDemoSeedAllowed({ NODE_ENV: 'production' });
    }).toThrow(/production/);
    expect(() => {
      assertDemoSeedAllowed({ NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      assertDemoSeedAllowed({});
    }).not.toThrow();
  });
});

describe('buildDemoPlan', () => {
  it('is deterministic for the same now', () => {
    const plan = () => buildDemoPlan({ now: NOW, random: mulberry32(DEMO_RANDOM_SEED) });
    expect(plan()).toEqual(plan());
  });

  it('follows now, so the data is always recent', () => {
    const later = new Date(NOW.getTime() + 100 * 86_400_000);
    const plan = buildDemoPlan({ now: later, random: mulberry32(DEMO_RANDOM_SEED) });
    const first = Math.min(...plan.cards.map((card) => card.createdAt.getTime()));
    expect(later.getTime() - first).toBeLessThanOrEqual((DEMO_HISTORY_DAYS + 1) * 86_400_000);
    for (const card of plan.cards) {
      for (const move of card.moves) expect(move.at.getTime()).toBeLessThanOrEqual(later.getTime());
    }
  });
});

describe('seedDemo', () => {
  it('creates the demo users, board and a realistic history', async () => {
    const result = await seed();
    expect(result).toMatchObject({
      email: DEMO_USER_EMAIL,
      password: DEFAULT_DEMO_PASSWORD,
      boardKey: 'DEMO',
      replacedBoards: 0,
    });

    const demoUser = await db.user.findUniqueOrThrow({ where: { email: DEMO_USER_EMAIL } });
    expect(demoUser.name).toBe('Demo User');
    expect(await compare(DEFAULT_DEMO_PASSWORD, demoUser.passwordHash)).toBe(true);
    expect(await db.user.count()).toBe(DEMO_USERS.length);

    const board = await db.board.findUniqueOrThrow({
      where: { id: result.boardId },
      include: {
        members: true,
        columns: { orderBy: { rank: 'asc' } },
        labels: true,
      },
    });
    expect(board).toMatchObject({ name: 'Webshop launch', key: 'DEMO', ownerId: demoUser.id });
    expect(board.members).toHaveLength(DEMO_USERS.length);
    expect(board.columns.map((c) => [c.title, c.category])).toEqual([
      ['Backlog', 'BACKLOG'],
      ['To Do', 'TODO'],
      ['In Progress', 'IN_PROGRESS'],
      ['Review', 'IN_PROGRESS'],
      ['Done', 'DONE'],
    ]);
    const categoryOf = new Map<string, ColumnCategory>(
      board.columns.map((column) => [column.id, column.category]),
    );

    const cards = await db.card.findMany({
      where: { boardId: board.id },
      include: { transitions: { orderBy: { movedAt: 'asc' } }, labels: true },
      orderBy: { number: 'asc' },
    });
    expect(cards.length).toBeGreaterThanOrEqual(55);
    expect(cards.length).toBeLessThanOrEqual(65);
    expect(cards.length).toBe(result.cardCount);
    expect(cards.map((card) => card.number)).toEqual(cards.map((_, index) => index + 1));
    expect(board.nextCardNumber).toBe(cards.length + 1);

    let reopened = 0;
    for (const card of cards) {
      const times = card.transitions.map((t) => t.movedAt.getTime());
      expect(times[0]).toBe(card.createdAt.getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1] ?? Infinity);
      }
      expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
      expect(card.createdAt.getTime()).toBeGreaterThanOrEqual(
        NOW.getTime() - (DEMO_HISTORY_DAYS + 1) * 86_400_000,
      );
      const last = card.transitions.at(-1);
      expect(last?.toColumnId).toBe(card.columnId);
      expect(card.updatedAt).toEqual(last?.movedAt);
      card.transitions.forEach((t, i) => {
        expect(t.fromColumnId).toBe(i === 0 ? null : card.transitions[i - 1]?.toColumnId);
      });
      const categories = card.transitions.map((t) => categoryOf.get(t.toColumnId ?? ''));
      if (categories.some((c, i) => c === 'DONE' && categories[i + 1] === 'IN_PROGRESS')) {
        reopened++;
      }
    }
    expect(reopened).toBeGreaterThanOrEqual(1);
    expect(result.transitionCount).toBe(cards.reduce((n, c) => n + c.transitions.length, 0));

    const finalCategories = cards.map((card) => categoryOf.get(card.columnId));
    expect(finalCategories.filter((c) => c === 'BACKLOG').length).toBeGreaterThan(0);
    expect(finalCategories.filter((c) => c === 'TODO').length).toBeGreaterThan(0);
    // Varied priorities, assignees and labels.
    expect(new Set(cards.map((card) => card.priority)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(cards.map((card) => card.assigneeId)).size).toBeGreaterThanOrEqual(4);
    expect(cards.filter((card) => card.labels.length > 0).length).toBe(cards.length);
  });

  it('produces flow analytics worth showing', async () => {
    const result = await seed();

    const response = await asDemo(result, `/boards/${result.boardId}/analytics`);
    expect(response.status).toBe(200);
    const analytics = analyticsResponseSchema.parse(response.body);
    expect(analytics.aging.thresholdDays).not.toBeNull();
    const aging = analytics.aging.items.filter((item) => item.isAging);
    expect(aging.length).toBeGreaterThanOrEqual(3);
    // Steady throughput of roughly one card per day over the last 30 days.
    const completed = analytics.throughput.daily.reduce((sum, day) => sum + day.count, 0);
    expect(completed / 30).toBeGreaterThanOrEqual(0.6);
    expect(completed / 30).toBeLessThanOrEqual(1.6);
    expect(analytics.leadCycle.cycleTime.p85).not.toBeNull();
    // Weekend dips: fewer completions on Saturdays and Sundays than on working days.
    const weekend = analytics.throughput.daily.filter((day) =>
      [0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay()),
    );
    const weekendRate = weekend.reduce((sum, day) => sum + day.count, 0) / weekend.length;
    expect(weekendRate).toBeLessThan(completed / 30);

    for (const query of ['?mode=count', `?mode=date&targetDate=${addDays(TODAY, 14)}`]) {
      const forecast = await asDemo(result, `/boards/${result.boardId}/analytics/forecast${query}`);
      expect(forecast.status).toBe(200);
      expect(forecastResponseSchema.parse(forecast.body).status).toBe('ok');
    }
  });

  it('replaces the previous demo board and keeps the users', async () => {
    const first = await seed();
    // Another board of the demo user is left alone.
    const other = await db.board.create({
      data: { name: 'Private', key: 'PRIV', ownerId: first.userIds.demo },
    });
    // A board with the same key owned by somebody else is left alone too.
    const stranger = await db.user.create({
      data: { email: 'someone@example.com', name: 'Someone', passwordHash: 'x' },
    });
    const strangersDemo = await db.board.create({
      data: { name: 'Their demo', key: 'DEMO', ownerId: stranger.id },
    });
    const second = await seed('another-password');
    expect(await db.board.findUnique({ where: { id: strangersDemo.id } })).not.toBeNull();

    expect(second.replacedBoards).toBe(1);
    expect(second.userIds).toEqual(first.userIds);
    expect(second.boardId).not.toBe(first.boardId);
    expect(await db.board.findUnique({ where: { id: first.boardId } })).toBeNull();
    expect(await db.board.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await db.user.count()).toBe(DEMO_USERS.length + 1);
    expect(await db.card.count()).toBe(second.cardCount);
    const demoUser = await db.user.findUniqueOrThrow({ where: { email: DEMO_USER_EMAIL } });
    expect(await compare('another-password', demoUser.passwordHash)).toBe(true);
  });

  it('rejects a password that breaks the password rules', async () => {
    await expect(seed('short')).rejects.toThrow();
    expect(await db.user.count()).toBe(0);
  });
});
