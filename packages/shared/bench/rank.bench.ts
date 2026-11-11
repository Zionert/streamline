/**
 * Benchmark: rank keys (LexoRank-style) vs integer positions with O(n) re-indexing.
 *
 * Run with `pnpm --filter @streamline/shared bench` (builds the package first, then runs this
 * file with Node's built-in TypeScript type stripping against the compiled output).
 *
 * Each scenario is first simulated on an in-memory list of rows (untimed). The simulation
 * counts how many rows get a new ordering value (= rows an UPDATE would touch in the database;
 * the primary, exact metric) and records a trace of the work each strategy has to do. The
 * trace is then replayed as one timed batch, so the timings cover only the computation of
 * new ordering values: moving rows inside the in-memory array (identical for both strategies)
 * and database writes are not included.
 *
 * - integer: positions are 0..n-1; a move rewrites every row between the old and new index,
 *   an insert rewrites the new row and every row after it.
 * - rank: one new key between the neighbours; when it gets longer than RANK_MAX_LENGTH the
 *   whole list is rebalanced, and those writes are counted too (amortized cost).
 */
import { RANK_MAX_LENGTH, rankBetween, rebalanceRanks } from '@streamline/shared';

const SIZES = [100, 1_000, 10_000, 100_000] as const;
const OPERATIONS = 1_000;
/** Each trace is replayed this many times (after one warm-up replay); the median is reported. */
const REPETITIONS = 5;
const SEED = 20261111;

type Scenario = 'start' | 'middle' | 'end' | 'random' | 'repeated';

const SCENARIOS: readonly { id: Scenario; title: string }[] = [
  { id: 'start', title: 'Move a random card to the start' },
  {
    id: 'middle',
    title: 'Move a random card to the same middle position (repeated pressure on one gap)',
  },
  { id: 'end', title: 'Move a random card to the end' },
  { id: 'random', title: 'Move a random card to a random position' },
  { id: 'repeated', title: `Insert ${OPERATIONS} new cards at one spot (worst case for ranks)` },
];

// Copied from test-utils/prng.ts: Node's type stripping cannot resolve the `.js` import
// specifiers used by typechecked sources, and the bench avoids adding a TypeScript loader.
/** Seeded PRNG (mulberry32) so every run produces the same operations. */
function createPrng(seed: number): (maxExclusive: number) => number {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * maxExclusive);
  };
}

interface Operation {
  /** Index of the moved row, or -1 for inserting a new row. */
  from: number;
  /** Target index after the row has been removed from `from`. */
  to: number;
}

/**
 * Deterministic list of operations for a scenario on a list of `size` rows. Moves never keep
 * a card in place (`from !== to`), so both strategies are compared on real changes only.
 */
function planOperations(
  scenario: Scenario,
  size: number,
  count: number,
  seed: number,
): Operation[] {
  const random = createPrng(seed);
  const operations: Operation[] = [];
  const middle = size >> 1;
  for (let i = 0; i < count; i++) {
    switch (scenario) {
      case 'start':
        operations.push({ from: 1 + random(size - 1), to: 0 });
        break;
      case 'middle':
        operations.push({ from: (middle + 1 + random(size - 1)) % size, to: middle });
        break;
      case 'end':
        operations.push({ from: random(size - 1), to: size - 1 });
        break;
      case 'random': {
        const from = random(size);
        operations.push({ from, to: (from + 1 + random(size - 1)) % size });
        break;
      }
      case 'repeated':
        // Always right after the same left neighbour, i.e. before the previously inserted row.
        operations.push({ from: -1, to: middle });
        break;
    }
  }
  return operations;
}

/** Index ranges whose integer positions are rewritten, two entries per operation. */
interface IntegerTrace {
  rowsWritten: number;
  ranges: Int32Array;
  maxRows: number;
}

interface IntegerRow {
  id: number;
  position: number;
}

function simulateInteger(size: number, operations: readonly Operation[]): IntegerTrace {
  const rows: number[] = Array.from({ length: size }, (_, i) => i);
  const ranges = new Int32Array(operations.length * 2);
  let rowsWritten = 0;
  let nextId = size;

  operations.forEach(({ from, to }, index) => {
    let first: number;
    let last: number;
    if (from < 0) {
      rows.splice(to, 0, nextId++);
      first = to;
      last = rows.length - 1;
    } else {
      const [row] = rows.splice(from, 1);
      if (row === undefined) throw new Error('Missing row');
      rows.splice(to, 0, row);
      first = Math.min(from, to);
      last = Math.max(from, to);
    }
    ranges[index * 2] = first;
    ranges[index * 2 + 1] = last;
    rowsWritten += last - first + 1;
  });

  return { rowsWritten, ranges, maxRows: rows.length };
}

/** Rewrites the positions of every recorded range as one batch; returns elapsed milliseconds. */
function replayInteger(trace: IntegerTrace): number {
  const rows: IntegerRow[] = Array.from({ length: trace.maxRows }, (_, i) => ({
    id: i,
    position: i,
  }));
  const { ranges } = trace;
  const started = process.hrtime.bigint();
  for (let op = 0; op < ranges.length; op += 2) {
    const last = ranges[op + 1] ?? -1;
    for (let i = ranges[op] ?? 0; i <= last; i++) {
      const row = rows[i];
      if (row !== undefined) row.position = i;
    }
  }
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Neighbour keys of one operation and the list size if it triggered a rebalance (else 0). */
interface RankStep {
  low: string | null;
  high: string | null;
  rebalanceSize: number;
}

interface RankTrace {
  rowsWritten: number;
  steps: RankStep[];
  maxRows: number;
  rebalances: number;
  maxKeyLength: number;
  avgKeyLength: number;
}

interface RankedRow {
  id: number;
  rank: string;
}

function simulateRank(size: number, operations: readonly Operation[]): RankTrace {
  const rows: RankedRow[] = rebalanceRanks(size).map((rank, i) => ({ id: i, rank }));
  const steps: RankStep[] = [];
  let rowsWritten = 0;
  let rebalances = 0;
  let nextId = size;

  for (const { from, to } of operations) {
    let row: RankedRow | undefined;
    if (from < 0) {
      row = { id: nextId++, rank: '' };
    } else {
      [row] = rows.splice(from, 1);
      if (row === undefined) throw new Error('Missing row');
    }
    rows.splice(to, 0, row);

    const low = rows[to - 1]?.rank ?? null;
    const high = rows[to + 1]?.rank ?? null;
    const key = rankBetween(low, high);
    row.rank = key;
    rowsWritten += 1;
    let rebalanceSize = 0;
    if (key.length > RANK_MAX_LENGTH) {
      const keys = rebalanceRanks(rows.length);
      rows.forEach((current, i) => {
        current.rank = keys[i] ?? '';
      });
      rebalanceSize = rows.length;
      rowsWritten += rows.length;
      rebalances++;
    }
    steps.push({ low, high, rebalanceSize });
  }

  let maxKeyLength = 0;
  let totalKeyLength = 0;
  for (const { rank } of rows) {
    maxKeyLength = Math.max(maxKeyLength, rank.length);
    totalKeyLength += rank.length;
  }
  return {
    rowsWritten,
    steps,
    maxRows: rows.length,
    rebalances,
    maxKeyLength,
    avgKeyLength: totalKeyLength / rows.length,
  };
}

/** Keeps computed keys observable so the JIT cannot drop the work. */
let sink = 0;

function runRankStep(step: RankStep, rows: RankedRow[]): void {
  const key = rankBetween(step.low, step.high);
  sink += key.length;
  if (step.rebalanceSize > 0) {
    const keys = rebalanceRanks(step.rebalanceSize);
    for (let i = 0; i < step.rebalanceSize; i++) {
      const row = rows[i];
      if (row !== undefined) row.rank = keys[i] ?? '';
    }
  }
}

function createRankRows(trace: RankTrace): RankedRow[] {
  return Array.from({ length: trace.maxRows }, (_, i) => ({ id: i, rank: '' }));
}

/** Computes every recorded key (and rebalance) as one batch; returns elapsed milliseconds. */
function replayRank(trace: RankTrace): number {
  const rows = createRankRows(trace);
  const started = process.hrtime.bigint();
  for (const step of trace.steps) runRankStep(step, rows);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Slowest single rank operation in milliseconds (a rebalance, if the trace has one). */
function slowestRankStep(trace: RankTrace): number {
  const rows = createRankRows(trace);
  let slowest = 0;
  for (const step of trace.steps) {
    const started = process.hrtime.bigint();
    runRankStep(step, rows);
    slowest = Math.max(slowest, Number(process.hrtime.bigint() - started) / 1e6);
  }
  return slowest;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + upper) / 2 : upper;
}

/** Median of REPETITIONS timed runs, after one untimed warm-up run. */
function measure(run: () => number): number {
  run();
  const times: number[] = [];
  for (let i = 0; i < REPETITIONS; i++) times.push(run());
  return median(times);
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMicros(ms: number): string {
  return formatNumber(ms * 1000, 3);
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---:')), ...rows.map(line)].join('\n');
}

function benchmarkScenario(scenario: Scenario): string[][] {
  return SIZES.map((size, sizeIndex) => {
    const seed = SEED + sizeIndex * 1009 + scenario.length;
    const operations = planOperations(scenario, size, OPERATIONS, seed);
    const integer = simulateInteger(size, operations);
    const rank = simulateRank(size, operations);
    const integerMs = measure(() => replayInteger(integer));
    const rankMs = measure(() => replayRank(rank));
    const slowestMs = measure(() => slowestRankStep(rank));
    return [
      formatNumber(size),
      formatNumber(integer.rowsWritten / OPERATIONS, 1),
      formatNumber(rank.rowsWritten / OPERATIONS, 2),
      formatMicros(integerMs / OPERATIONS),
      formatMicros(rankMs / OPERATIONS),
      formatMicros(slowestMs),
      String(rank.maxKeyLength),
      formatNumber(rank.avgKeyLength, 2),
      String(rank.rebalances),
    ];
  });
}

type Pattern = 'after-left' | 'before-right' | 'zigzag' | 'append' | 'prepend';

const PATTERNS: readonly { id: Pattern; title: string }[] = [
  { id: 'after-left', title: 'same spot, right after a fixed neighbour' },
  { id: 'before-right', title: 'same spot, right before a fixed neighbour' },
  { id: 'zigzag', title: 'same gap, alternating sides' },
  { id: 'append', title: 'always at the end' },
  { id: 'prepend', title: 'always at the start' },
];

/** Number of inserts into a freshly rebalanced list until a key exceeds RANK_MAX_LENGTH. */
function insertsUntilRebalance(size: number, pattern: Pattern): number {
  const keys = rebalanceRanks(size);
  const mid = size >> 1;
  let low: string | null = keys[mid - 1] ?? null;
  let high: string | null = keys[mid] ?? null;
  if (pattern === 'append') {
    low = keys[size - 1] ?? null;
    high = null;
  } else if (pattern === 'prepend') {
    low = null;
    high = keys[0] ?? null;
  }

  for (let inserts = 1; ; inserts++) {
    const key = rankBetween(low, high);
    if (key.length > RANK_MAX_LENGTH) return inserts;
    if (pattern === 'after-left' || pattern === 'prepend') high = key;
    else if (pattern === 'before-right' || pattern === 'append') low = key;
    else if (inserts % 2 === 0) high = key;
    else low = key;
  }
}

function main(): void {
  const started = performance.now();
  const out: string[] = [];
  out.push('# Rank keys vs integer re-indexing');
  out.push('');
  out.push(
    `Node ${process.version}, ${OPERATIONS} operations per cell, seed ${SEED}, ` +
      `RANK_MAX_LENGTH = ${RANK_MAX_LENGTH}.`,
    '',
    '- **rows/op** is the primary metric: the average number of rows whose ordering value ' +
      'changes, i.e. database writes per operation (for ranks including rebalancing). It is ' +
      'exact and deterministic.',
    '- **µs/op** columns cover only the in-memory computation of new ordering values, not ' +
      `database writes: each batch of ${OPERATIONS} operations is timed as a whole and divided ` +
      `by ${OPERATIONS} (median of ${REPETITIONS} batches after a warm-up).`,
    '- **rank slowest op** is the most expensive single operation, timed individually; it is ' +
      'meaningful when a rebalance happened, otherwise it mostly reflects timer overhead.',
  );

  const header = [
    'n',
    'int rows/op',
    'rank rows/op',
    'int µs/op',
    'rank µs/op',
    'rank slowest op µs',
    'rank max len',
    'rank avg len',
    'rebalances',
  ];
  for (const { id, title } of SCENARIOS) {
    out.push('', `## ${title}`, '', table(header, benchmarkScenario(id)));
  }

  out.push('', '## Worst case: inserts until a rebalance is needed', '');
  out.push(
    table(
      ['n (initial key length)', ...PATTERNS.map(({ title }) => title)],
      SIZES.map((size) => [
        `${formatNumber(size)} (${rebalanceRanks(size).at(-1)?.length ?? 0})`,
        ...PATTERNS.map(({ id }) => formatNumber(insertsUntilRebalance(size, id))),
      ]),
    ),
  );

  out.push(
    '',
    `_Total benchmark time: ${formatNumber((performance.now() - started) / 1000, 1)} s_`,
  );
  console.log(out.join('\n'));
  // Never true; reading the sink keeps the replayed computations from being optimized away.
  if (sink < 0) console.log(sink);
}

main();
