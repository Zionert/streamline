import {
  mulberry32,
  passwordSchema,
  rankSequenceBetween,
  type RandomSource,
} from '@streamline/shared';

import type { DbClient } from '../repositories/db.js';
import {
  createDemoSeedRepository,
  type DemoBoardCard,
} from '../repositories/demo-seed.repository.js';
import { createPasswordHasher } from '../services/password.service.js';
import {
  DEMO_BOARD,
  DEMO_COLUMNS,
  DEMO_LABELS,
  DEMO_USER_EMAIL,
  DEMO_USERS,
  buildDemoPlan,
  type DemoUserKey,
} from './demo-plan.js';

/** Password of the demo accounts when `DEMO_PASSWORD` is not set. */
export const DEFAULT_DEMO_PASSWORD = 'streamline-demo';
/** Seed of the generator: the same `now` always gives the same board. */
export const DEMO_RANDOM_SEED = 20261117;

export interface SeedDemoOptions {
  /** History is generated for the days before this instant (default: the current time). */
  now?: Date;
  random?: RandomSource;
  /** Password of all demo accounts; must satisfy the password rules. */
  password?: string;
  /** bcrypt cost of the password hashes. */
  bcryptCost: number;
}

export interface SeedDemoResult {
  email: string;
  password: string;
  boardId: string;
  boardKey: string;
  cardCount: number;
  transitionCount: number;
  /** Demo boards deleted before creating the new one (0 on the first run). */
  replacedBoards: number;
  userIds: Record<DemoUserKey, string>;
}

/** Throws unless the environment allows seeding demo data (never in production). */
export function assertDemoSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }
}

/**
 * Creates (or recreates) the demo board "Webshop launch" (key `DEMO`) owned by
 * `demo@streamline.local`, with three more members as assignees and ~60 cards whose backdated
 * transitions describe the ~60 days before `now`. Users are kept between runs (their name and
 * password are updated); the previous demo board of the demo user is replaced.
 */
export async function seedDemo(db: DbClient, options: SeedDemoOptions): Promise<SeedDemoResult> {
  const now = options.now ?? new Date();
  const password = passwordSchema.parse(options.password ?? DEFAULT_DEMO_PASSWORD);
  const repository = createDemoSeedRepository(db);
  const passwordHash = await createPasswordHasher(options.bcryptCost).hash(password);

  const userIds = {} as Record<DemoUserKey, string>;
  for (const user of DEMO_USERS) {
    userIds[user.key] = await repository.upsertUser({
      email: user.email,
      name: user.name,
      passwordHash,
    });
  }

  const plan = buildDemoPlan({ now, random: options.random ?? mulberry32(DEMO_RANDOM_SEED) });
  const columnIndex = new Map(DEMO_COLUMNS.map((column, index) => [column.key, index]));
  const labelIndex = new Map(DEMO_LABELS.map((label, index) => [label.key, index]));
  const indexOf = <K>(map: Map<K, number>, key: K): number => {
    const index = map.get(key);
    if (index === undefined) throw new Error(`Unknown demo key ${String(key)}`);
    return index;
  };

  const lastMoves = plan.cards.map((card) => {
    const last = card.moves.at(-1);
    if (!last) throw new Error(`Demo card ${card.title} has no moves`);
    return { at: last.at, column: indexOf(columnIndex, last.column) };
  });
  // Cards of each column are ranked in creation order.
  const columnRanks = DEMO_COLUMNS.map((_, column) =>
    rankSequenceBetween(null, null, lastMoves.filter((last) => last.column === column).length),
  );

  const cards: DemoBoardCard[] = plan.cards.map((card, index) => {
    const last = lastMoves[index];
    const rank = last ? columnRanks[last.column]?.shift() : undefined;
    if (!last || rank === undefined) throw new Error(`Demo card ${card.title} has no rank`);
    return {
      number: index + 1,
      title: card.title,
      column: last.column,
      rank,
      priority: card.priority,
      assigneeId: card.assignee ? userIds[card.assignee] : null,
      dueDate: card.dueDate,
      createdAt: card.createdAt,
      updatedAt: last.at,
      labels: card.labels.map((label) => indexOf(labelIndex, label)),
      transitions: card.moves.map((move) => ({
        column: indexOf(columnIndex, move.column),
        at: move.at,
      })),
    };
  });
  const boardColumnRanks = rankSequenceBetween(null, null, DEMO_COLUMNS.length);

  const { boardId, deletedBoards } = await repository.replaceBoard({
    name: DEMO_BOARD.name,
    key: DEMO_BOARD.key,
    ownerId: userIds.demo,
    createdAt: plan.boardCreatedAt,
    members: [
      { userId: userIds.anna, role: 'ADMIN' },
      { userId: userIds.marek, role: 'MEMBER' },
      { userId: userIds.olena, role: 'MEMBER' },
    ],
    columns: DEMO_COLUMNS.map((column, index) => ({
      title: column.title,
      rank: boardColumnRanks[index] ?? '',
      category: column.category,
    })),
    labels: DEMO_LABELS.map(({ name, color }) => ({ name, color })),
    cards,
  });

  return {
    email: DEMO_USER_EMAIL,
    password,
    boardId,
    boardKey: DEMO_BOARD.key,
    cardCount: cards.length,
    transitionCount: cards.reduce((sum, card) => sum + card.transitions.length, 0),
    replacedBoards: deletedBoards,
    userIds,
  };
}
