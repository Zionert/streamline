import type { CardPriority, ColumnCategory, LabelColor, RandomSource } from '@streamline/shared';

/**
 * Deterministic plan of the demo board: a webshop project with about 60 cards whose history
 * spans the ~60 days before `now`. Only the plan is computed here (no database access), so it
 * can be inspected and tested on its own.
 */

export type DemoUserKey = 'demo' | 'anna' | 'marek' | 'olena';
export type DemoColumnKey = 'backlog' | 'todo' | 'inProgress' | 'review' | 'done';
export type DemoLabelKey = 'frontend' | 'backend' | 'bug' | 'design' | 'infra';

export interface DemoUser {
  key: DemoUserKey;
  email: string;
  name: string;
}

export const DEMO_USER_EMAIL = 'demo@streamline.local';

export const DEMO_USERS: readonly DemoUser[] = [
  { key: 'demo', email: DEMO_USER_EMAIL, name: 'Demo User' },
  { key: 'anna', email: 'anna.kowalska@streamline.local', name: 'Anna Kowalska' },
  { key: 'marek', email: 'marek.nowak@streamline.local', name: 'Marek Nowak' },
  { key: 'olena', email: 'olena.koval@streamline.local', name: 'Olena Koval' },
];

export const DEMO_BOARD = { name: 'Webshop launch', key: 'DEMO' } as const;

export const DEMO_COLUMNS: readonly {
  key: DemoColumnKey;
  title: string;
  category: ColumnCategory;
}[] = [
  { key: 'backlog', title: 'Backlog', category: 'BACKLOG' },
  { key: 'todo', title: 'To Do', category: 'TODO' },
  { key: 'inProgress', title: 'In Progress', category: 'IN_PROGRESS' },
  { key: 'review', title: 'Review', category: 'IN_PROGRESS' },
  { key: 'done', title: 'Done', category: 'DONE' },
];

export const DEMO_LABELS: readonly { key: DemoLabelKey; name: string; color: LabelColor }[] = [
  { key: 'frontend', name: 'Frontend', color: 'BLUE' },
  { key: 'backend', name: 'Backend', color: 'PURPLE' },
  { key: 'bug', name: 'Bug', color: 'RED' },
  { key: 'design', name: 'Design', color: 'PINK' },
  { key: 'infra', name: 'Infrastructure', color: 'GRAY' },
];

/** Card titles in creation order, with their labels. */
const CARD_TITLES: readonly (readonly [string, readonly DemoLabelKey[]])[] = [
  ['Set up the repository and CI pipeline', ['infra']],
  ['Define the product data model', ['backend']],
  ['Wireframes of the home page', ['design']],
  ['Product list API with pagination', ['backend']],
  ['Design system: colors and typography', ['design', 'frontend']],
  ['Product list page', ['frontend']],
  ['Product details page', ['frontend']],
  ['Image upload for products', ['backend']],
  ['Search by product name', ['backend', 'frontend']],
  ['Category navigation menu', ['frontend']],
  ['Shopping cart API', ['backend']],
  ['Add to cart button', ['frontend']],
  ['Cart page with quantity editing', ['frontend']],
  ['Price shows wrong currency symbol', ['bug', 'frontend']],
  ['User registration and login', ['backend', 'frontend']],
  ['Password reset by email', ['backend']],
  ['Checkout flow design', ['design']],
  ['Shipping address form', ['frontend']],
  ['Shipping cost calculation', ['backend']],
  ['Payment provider integration', ['backend']],
  ['Order confirmation email', ['backend']],
  ['Order history page', ['frontend']],
  ['Cart is emptied after login', ['bug']],
  ['Staging environment', ['infra']],
  ['Product filters (price, brand)', ['frontend', 'backend']],
  ['Sorting of the product list', ['frontend']],
  ['Stock levels per product', ['backend']],
  ['Out-of-stock badge', ['frontend']],
  ['Discount codes', ['backend', 'frontend']],
  ['Admin: product editor', ['frontend']],
  ['Admin: order list', ['frontend', 'backend']],
  ['Images are not resized on upload', ['bug', 'backend']],
  ['Mobile layout of the header', ['frontend', 'design']],
  ['Newsletter sign-up', ['frontend']],
  ['Product reviews API', ['backend']],
  ['Product reviews section', ['frontend']],
  ['Wishlist', ['frontend', 'backend']],
  ['Database backups', ['infra']],
  ['Checkout fails for long addresses', ['bug']],
  ['VAT invoices as PDF', ['backend']],
  ['Cookie consent banner', ['frontend']],
  ['Terms and privacy pages', ['frontend']],
  ['SEO metadata for product pages', ['frontend']],
  ['Sitemap generation', ['backend']],
  ['Error monitoring', ['infra']],
  ['Load test of the checkout', ['infra']],
  ['Related products carousel', ['frontend', 'design']],
  ['Order status updates by email', ['backend']],
  ['Returns request form', ['frontend', 'backend']],
  ['Search results are case sensitive', ['bug', 'backend']],
  ['Accessibility audit fixes', ['frontend']],
  ['Gift cards', ['backend']],
  ['Recently viewed products', ['frontend']],
  ['Admin: sales dashboard', ['frontend', 'backend']],
  ['Production deployment checklist', ['infra']],
  ['Translations: Polish and Ukrainian', ['frontend']],
  ['Live chat widget', ['frontend']],
  ['Product comparison', ['frontend', 'design']],
  ['Loyalty points', ['backend']],
  ['Dark mode of the storefront', ['design', 'frontend']],
  ['Saved payment methods', ['backend']],
  ['Launch announcement page', ['design']],
];

/** Cards (by index) completed, then reopened and completed again. */
const REOPENED = new Set([4, 13, 22]);
/** Cards (by index) stuck in progress for weeks. */
const STUCK_IN_PROGRESS = new Map<number, DemoColumnKey>([
  [19, 'inProgress'],
  [26, 'review'],
  [31, 'inProgress'],
  [36, 'inProgress'],
]);
/** Cards (by index) that never leave the backlog. */
const ICEBOX = new Set([33, 40, 51]);
/** Recent cards (by index) created in To Do and still waiting there. */
const WAITING_IN_TODO = new Set([54, 57, 60]);

export interface DemoMove {
  at: Date;
  column: DemoColumnKey;
}

export interface DemoCardPlan {
  title: string;
  createdAt: Date;
  /** Oldest first; the first move is the creation, the last one the current column. */
  moves: DemoMove[];
  priority: CardPriority;
  assignee: DemoUserKey | null;
  labels: readonly DemoLabelKey[];
  /** Calendar date (UTC midnight) or `null`. */
  dueDate: Date | null;
}

export interface DemoPlan {
  boardCreatedAt: Date;
  cards: DemoCardPlan[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Days of history before `now`. */
export const DEMO_HISTORY_DAYS = 60;

/** Builds the plan; equal `now` and an equally seeded `random` give an equal plan. */
export function buildDemoPlan({ now, random }: { now: Date; random: RandomSource }): DemoPlan {
  const between = (min: number, max: number) => min + random() * (max - min);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('Cannot pick from an empty list');
    return item;
  };
  const nowMs = now.getTime();
  const firstDay = Math.floor(nowMs / DAY_MS) * DAY_MS - DEMO_HISTORY_DAYS * DAY_MS;

  /** Moves weekend instants to Monday morning most of the time (people rarely work then). */
  const workingTime = (ms: number): number => {
    const weekday = new Date(ms).getUTCDay();
    if ((weekday === 0 || weekday === 6) && random() < 0.85) {
      const toMonday = weekday === 6 ? 2 : 1;
      return Math.floor(ms / DAY_MS) * DAY_MS + toMonday * DAY_MS + between(7, 10) * HOUR_MS;
    }
    return ms;
  };

  const cards: DemoCardPlan[] = CARD_TITLES.map(([title, labels], index) => {
    // Creation spread over the history, during working hours (UTC 7-16).
    const createdDay = Math.floor((index * (DEMO_HISTORY_DAYS - 3)) / CARD_TITLES.length);
    const createdAt = Math.min(
      workingTime(firstDay + (createdDay + between(0, 1)) * DAY_MS + between(7, 16) * HOUR_MS),
      nowMs - between(1, 3) * HOUR_MS,
    );

    const moves: DemoMove[] = [];
    let at = createdAt;
    let stopped = false;
    /** Appends a move `afterDays` later; false (and nothing more) once it would be in the future. */
    const move = (column: DemoColumnKey, afterDays: number): boolean => {
      if (stopped) return false;
      const next =
        moves.length === 0
          ? at
          : Math.max(workingTime(at + afterDays * DAY_MS), at + between(0.2, 1) * HOUR_MS);
      if (next > nowMs) {
        stopped = true;
        return false;
      }
      at = next;
      moves.push({ at: new Date(at), column });
      return true;
    };

    const stuck = STUCK_IN_PROGRESS.get(index);
    const roll = random();
    if (ICEBOX.has(index)) {
      move('backlog', 0);
    } else if (WAITING_IN_TODO.has(index)) {
      move('todo', 0);
    } else if (stuck) {
      move('todo', 0);
      move('inProgress', between(0.5, 2));
      if (stuck === 'review') move('review', between(1, 3));
    } else {
      const start: DemoColumnKey = roll < 0.5 ? 'backlog' : roll < 0.85 ? 'todo' : 'inProgress';
      move(start, 0);
      if (start === 'backlog') move('todo', between(2, 12));
      if (start !== 'inProgress') move('inProgress', between(0.5, 6));
      move('review', between(0.8, 4.5));
      move('done', between(0.1, 1.5));
      if (REOPENED.has(index)) {
        move('inProgress', between(1, 3));
        move('review', between(0.5, 2));
        move('done', between(0.2, 1));
      }
    }

    const current = moves.at(-1)?.column ?? 'backlog';
    const started = current !== 'backlog';
    const assignee: DemoUserKey | null =
      started || random() < 0.3 ? pick(DEMO_USERS.map((user) => user.key)) : null;
    const priorityRoll = random();
    const priority: CardPriority =
      priorityRoll < 0.2
        ? 'LOW'
        : priorityRoll < 0.65
          ? 'MEDIUM'
          : priorityRoll < 0.9
            ? 'HIGH'
            : 'URGENT';
    const dueDate =
      current !== 'done' && random() < 0.35
        ? new Date(Math.floor(nowMs / DAY_MS) * DAY_MS + Math.round(between(2, 21)) * DAY_MS)
        : null;

    return {
      title,
      createdAt: new Date(createdAt),
      moves,
      priority,
      assignee,
      labels,
      dueDate,
    };
  });

  return { boardCreatedAt: new Date(firstDay - DAY_MS), cards };
}
