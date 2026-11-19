/**
 * Smoke test and latency measurement of the AI assistant's model: `pnpm ai:smoke` (from the
 * repository root). Not part of CI; it calls the configured provider over the network.
 *
 * Configuration: AI_ENABLED=true, LLM_BASE_URL, LLM_MODEL and optionally LLM_API_KEY,
 * LLM_TIMEOUT_MS, LLM_IDLE_TIMEOUT_MS, LLM_REASONING_EFFORT from apps/api/.env or the environment
 * (the environment wins).
 *
 * Options:
 *   --runs N       number of measured plain prompts (default 10; Polish, Ukrainian and English)
 *   --no-warmup    measure the first call too (by default one unmeasured call loads the model)
 *   --json         also write the results to ai-smoke-<timestamp>.json in the current directory
 *   --reasoning V  reasoning_effort for this run (none|minimal|low|medium|high|default),
 *                  overriding LLM_REASONING_EFFORT
 *   --delay-ms N   pause between two model calls (default 0; 6000 with --board-context), e.g. to
 *                  stay within the per-minute limits of a free tier
 *   --board-context
 *                  measure with a realistic board chat prompt instead (see below)
 *   --board-key K  board of the demo user used by --board-context (default DEMO)
 *   --tool-choice C
 *                  tool_choice of the --board-context requests: auto (default; the model may call
 *                  another tool first) or none (tools stay defined, the model must answer with
 *                  text, which measures the time to the first token of a text answer)
 *
 * Board context mode (`pnpm ai:smoke --board-context`): needs the database (DATABASE_URL and the
 * other API variables) with the demo board seeded by `pnpm db:seed:demo`. Each run sends the same
 * request as a board chat turn that has just read the board overview and the card list: the
 * assistant's system prompt, its tool definitions and the two tool results in the chat's format,
 * built by the chat service itself. The estimated prompt size is printed together with the
 * prompt tokens reported by the provider. A rate-limited call (HTTP 429) is reported and the
 * measurement goes on after the delay; there is no retry.
 *
 * Besides the plain prompts, one tool-calling prompt checks that the model returns a tool call
 * whose arguments pass a Zod schema (with the same single correction attempt as the assistant).
 *
 * Time to first token (TTFT) is measured from sending the request to the first fragment of the
 * answer: the first non-empty text delta, or the first tool call fragment when the answer starts
 * with a tool call. Reasoning ("thinking") tokens do not count as the answer; the time to the
 * first of them is shown separately. WNF-09 target: first fragment below 3 s at p95.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { AiValidationError, LlmError } from '../src/ai/ai-errors.js';
import { createLlmProvider } from '../src/ai/create-llm-provider.js';
import type { LlmMessage, LlmProvider, LlmRequest } from '../src/ai/llm-provider.js';
import {
  runWithValidation,
  toolCallArguments,
  collectResponse,
} from '../src/ai/run-with-validation.js';
import {
  RunRecorder,
  formatMs,
  formatTable,
  shareBelow,
  summarize,
  type LatencySummary,
  type RunMetrics,
} from '../src/ai/smoke-metrics.js';
import { loadAiConfig, loadConfig } from '../src/config/env.js';
import { DEMO_USER_EMAIL } from '../src/demo/demo-plan.js';
import { createAnalyticsRepository } from '../src/repositories/analytics.repository.js';
import { createBoardMemberRepository } from '../src/repositories/board-member.repository.js';
import { createBoardRepository } from '../src/repositories/board.repository.js';
import { createCardRepository } from '../src/repositories/card.repository.js';
import { createColumnRepository } from '../src/repositories/column.repository.js';
import { createCommentRepository } from '../src/repositories/comment.repository.js';
import { createDbClient } from '../src/repositories/db.js';
import { createLabelRepository } from '../src/repositories/label.repository.js';
import { createUserRepository } from '../src/repositories/user.repository.js';
import { buildBoardContextPreview } from '../src/services/ai-chat.service.js';
import { createBoardTools } from '../src/services/ai-tools/board-tools.js';
import { createAnalyticsService } from '../src/services/analytics.service.js';
import { createBoardAccessService } from '../src/services/board-access.service.js';
import { createBoardService } from '../src/services/board.service.js';
import { createCardService } from '../src/services/card.service.js';
import { createColumnService } from '../src/services/column.service.js';
import { createCommentService } from '../src/services/comment.service.js';
import { createLabelService } from '../src/services/label.service.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const TTFT_TARGET_MS = 3000;

const SYSTEM_PROMPT =
  'You are the assistant of StreamLine, a Kanban project management app. ' +
  "Answer briefly (at most three sentences) in the user's language.";

const PROMPTS: { lang: string; text: string }[] = [
  { lang: 'pl', text: 'Wyjaśnij w dwóch zdaniach, czym jest tablica Kanban.' },
  { lang: 'uk', text: 'Поясни у двох реченнях, що таке час циклу задачі.' },
  { lang: 'en', text: 'In two sentences, what is a sprint retrospective?' },
  { lang: 'pl', text: 'Podaj trzy krótkie wskazówki, jak ograniczać pracę w toku (WIP).' },
  { lang: 'uk', text: 'Назви три ризики, коли команда бере забагато задач одночасно.' },
  { lang: 'en', text: 'Give three short tips for writing good acceptance criteria.' },
];

const createCardArgsSchema = z.object({
  title: z.string().min(3).max(120),
  estimateDays: z.number().positive().max(30),
  priority: z.enum(['low', 'medium', 'high']),
});

const TOOL_PROMPT =
  'Dodaj kartę: przygotować testy strony logowania, ocena 2 dni, wysoki priorytet. Użyj narzędzia.';

interface PlainRun extends RunMetrics {
  run: number;
  lang: string;
  error: string | null;
}

interface ToolRun extends RunMetrics {
  valid: boolean;
  attempts: number | null;
  arguments: unknown;
  error: string | null;
}

/** Default pause between calls in board context mode (free tiers limit requests per minute). */
const BOARD_CONTEXT_DEFAULT_DELAY_MS = 6000;

/** Questions of the board context runs (Polish, Ukrainian, English). */
const BOARD_QUESTIONS: { lang: string; text: string }[] = [
  { lang: 'pl', text: 'Które karty są teraz zagrożone i co radzisz zrobić w tym tygodniu?' },
  { lang: 'uk', text: 'Підсумуй стан дошки: що в роботі, що застрягло і хто перевантажений?' },
  {
    lang: 'en',
    text: 'Summarize the board: what is in progress, what is stuck, who is overloaded?',
  },
];

function parseOptions() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '10' },
      reasoning: { type: 'string' },
      warmup: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
      'delay-ms': { type: 'string' },
      'board-context': { type: 'boolean', default: false },
      'board-key': { type: 'string', default: 'DEMO' },
      'tool-choice': { type: 'string', default: 'auto' },
    },
    allowNegative: true,
  });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 1000) {
    throw new Error('--runs must be an integer between 1 and 1000');
  }
  const boardContext = values['board-context'];
  const delayMs = Number(values['delay-ms'] ?? (boardContext ? BOARD_CONTEXT_DEFAULT_DELAY_MS : 0));
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 600_000) {
    throw new Error('--delay-ms must be an integer between 0 and 600000');
  }
  const toolChoice = parseToolChoice(values['tool-choice']);
  return {
    runs,
    toolChoice,
    warmup: values.warmup,
    json: values.json,
    reasoning: values.reasoning,
    delayMs,
    boardContext,
    boardKey: values['board-key'].trim().toUpperCase(),
  };
}

type SmokeOptions = ReturnType<typeof parseOptions>;

function parseToolChoice(value: string): 'auto' | 'none' {
  const choice = value.trim().toLowerCase();
  if (choice === 'auto' || choice === 'none') return choice;
  throw new Error('--tool-choice must be auto or none');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The provider rejected the call because of its rate limits (reported, never retried). */
function isRateLimited(err: unknown): boolean {
  return err instanceof LlmError && err.providerStatus === 429;
}

function describeError(err: unknown): string {
  if (err instanceof LlmError) {
    return `${err.code}: ${err.message}${err.providerMessage ? ` (${err.providerMessage})` : ''}`;
  }
  if (err instanceof AiValidationError) {
    return `${err.code}: ${err.issues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`).join('; ')}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function summaryRow(label: string, summary: LatencySummary | null): string[] {
  return [
    label,
    String(summary?.count ?? 0),
    formatMs(summary?.min ?? null),
    formatMs(summary?.median ?? null),
    formatMs(summary?.p95 ?? null),
    formatMs(summary?.max ?? null),
  ];
}

/** A failure that makes further runs pointless (provider down, wrong URL, model or key). */
function isFatal(err: unknown): boolean {
  return (
    err instanceof LlmError && (err.code === 'LLM_UNAVAILABLE' || err.code === 'LLM_HTTP_ERROR')
  );
}

interface BoardContextRun extends RunMetrics {
  run: number;
  lang: string;
  estimatedPromptTokens: number;
  rateLimited: boolean;
  error: string | null;
}

/**
 * Measures the time to first token with the request a board chat sends after reading the demo
 * board (system prompt, tool definitions, board overview and card list).
 */
async function runBoardContext(options: SmokeOptions): Promise<void> {
  const config = loadConfig(
    options.reasoning === undefined
      ? process.env
      : { ...process.env, LLM_REASONING_EFFORT: options.reasoning },
  );
  if (!config.AI_ENABLED) {
    throw new Error(
      'The AI assistant is disabled. Set AI_ENABLED=true, LLM_BASE_URL and LLM_MODEL.',
    );
  }
  let recorder = new RunRecorder(() => performance.now());
  const provider = createLlmProvider(config, {
    onDiagnostic: (diagnostic) => recorder.onDiagnostic(diagnostic),
  });
  if (!provider) throw new Error('The AI provider could not be created');
  const host = new URL(config.LLM_BASE_URL ?? '').host;

  const db = createDbClient(config.DATABASE_URL);
  try {
    const users = createUserRepository(db);
    const members = createBoardMemberRepository(db);
    const boardService = createBoardService({
      boards: createBoardRepository(db),
      members,
      users,
    });
    const boardAccess = createBoardAccessService({ members });
    const tools = createBoardTools({
      boardService,
      columnService: createColumnService({ columns: createColumnRepository(db) }),
      cardService: createCardService({ cards: createCardRepository(db) }),
      labelService: createLabelService({ labels: createLabelRepository(db) }),
      commentService: createCommentService({ comments: createCommentRepository(db) }),
      analyticsService: createAnalyticsService({ analytics: createAnalyticsRepository(db) }),
    });

    const demoUser = await users.findByEmail(DEMO_USER_EMAIL);
    const board = demoUser
      ? (await boardService.listForUser(demoUser.id)).find((item) => item.key === options.boardKey)
      : undefined;
    if (!demoUser || !board) {
      throw new Error(
        `Board ${options.boardKey} of ${DEMO_USER_EMAIL} not found. Seed it first: pnpm db:seed:demo`,
      );
    }
    const membership = await boardAccess.require(board.id, demoUser.id, 'board:view');
    const previews = await Promise.all(
      BOARD_QUESTIONS.map(async (question) => ({
        ...question,
        ...(await buildBoardContextPreview({
          tools,
          boardService,
          membership,
          question: question.text,
          now: new Date(),
          contextTokens: config.LLM_CONTEXT_TOKENS,
        })),
      })),
    );
    const first = previews[0];
    if (!first) throw new Error('No board context questions');
    const promptChars = first.request.messages.reduce(
      (sum, message) => sum + (message.content?.length ?? 0),
      JSON.stringify(first.request.tools ?? []).length,
    );

    console.info(
      `Model: ${provider.model} at ${host}; reasoning_effort: ${config.LLM_REASONING_EFFORT}; ` +
        `board ${board.key} "${board.name}"; ${String(options.runs)} measured runs; ` +
        `${String(options.delayMs)} ms between calls; tool_choice: ${options.toolChoice}.`,
    );
    console.info(
      `Prompt: ${String(first.request.messages.length)} messages, ${String(promptChars)} characters, ` +
        `estimated ${String(first.estimatedTokens)} tokens (LLM_CONTEXT_TOKENS=${String(config.LLM_CONTEXT_TOKENS)}).`,
    );

    const measure = async (request: LlmRequest): Promise<RunMetrics> => {
      recorder = new RunRecorder(() => performance.now());
      const withChoice: LlmRequest = { ...request, toolChoice: options.toolChoice };
      await collectResponse(provider.streamChat(withChoice), (event) => recorder.onEvent(event));
      return recorder.finish();
    };

    let coldStart: RunMetrics | null = null;
    if (options.warmup) {
      console.info('Warm-up call (not measured)…');
      try {
        coldStart = await measure(first.request);
      } catch (err) {
        if (!isRateLimited(err))
          throw new Error(`Warm-up failed: ${describeError(err)}`, { cause: err });
        console.info('Warm-up was rate limited (HTTP 429).');
      }
      await sleep(options.delayMs);
    }

    const runs: BoardContextRun[] = [];
    for (let index = 0; index < options.runs; index += 1) {
      if (index > 0) await sleep(options.delayMs);
      const preview = previews[index % previews.length] ?? first;
      const base = {
        run: index + 1,
        lang: preview.lang,
        estimatedPromptTokens: preview.estimatedTokens,
      };
      try {
        runs.push({
          ...base,
          rateLimited: false,
          error: null,
          ...(await measure(preview.request)),
        });
      } catch (err) {
        if (isFatal(err) && !isRateLimited(err))
          throw new Error(describeError(err), { cause: err });
        runs.push({
          ...base,
          rateLimited: isRateLimited(err),
          error: isRateLimited(err) ? 'rate limited (HTTP 429)' : describeError(err),
          ...recorder.finish(),
        });
      }
      process.stdout.write(runs.at(-1)?.rateLimited ? 'R' : '.');
    }
    process.stdout.write('\n');

    console.info(
      formatTable(
        [
          'run',
          'lang',
          'TTFT',
          'total',
          'prompt tok (provider)',
          'prompt tok (estimate)',
          'completion tok',
          'finish',
        ],
        runs.map((run) => [
          String(run.run),
          run.lang,
          formatMs(run.ttftMs),
          formatMs(run.totalMs),
          run.promptTokens === null ? '-' : String(run.promptTokens),
          String(run.estimatedPromptTokens),
          run.completionTokens === null ? '-' : String(run.completionTokens),
          run.error ?? run.finishReason ?? '-',
        ]),
      ),
    );
    const ok = runs.filter((run) => run.error === null);
    const ttfts = ok.flatMap((run) => (run.ttftMs === null ? [] : [run.ttftMs]));
    const ttftSummary = summarize(ttfts);
    const totalSummary = summarize(ok.map((run) => run.totalMs));
    const reported = ok.flatMap((run) => (run.promptTokens === null ? [] : [run.promptTokens]));
    const below = shareBelow(ttfts, TTFT_TARGET_MS);
    console.info('');
    console.info(
      formatTable(
        ['metric', 'n', 'min', 'median', 'p95', 'max'],
        [summaryRow('TTFT', ttftSummary), summaryRow('total', totalSummary)],
      ),
    );
    console.info('');
    console.info(
      `Runs:             ${String(runs.length)} (${String(runs.length - ok.length)} failed, ${String(runs.filter((run) => run.rateLimited).length)} rate limited)`,
    );
    console.info(
      `Prompt tokens:    estimated ${String(first.estimatedTokens)}; reported by the provider ${
        reported.length === 0
          ? 'n/a'
          : `${String(Math.min(...reported))}-${String(Math.max(...reported))}`
      }`,
    );
    console.info(
      `TTFT < 3 s:       ${below === null ? '-' : `${(below * 100).toFixed(0)}%`} of runs (WNF-09 target: p95 < 3 s → ${
        ttftSummary === null ? 'n/a' : ttftSummary.p95 < TTFT_TARGET_MS ? 'MET' : 'NOT MET'
      })`,
    );
    if (coldStart) {
      console.info(
        `Warm-up (cold):   TTFT ${formatMs(coldStart.ttftMs)}, total ${formatMs(coldStart.totalMs)}`,
      );
    }

    if (options.json) {
      const finishedAt = new Date().toISOString();
      const file = join(
        process.env.INIT_CWD ?? process.cwd(),
        `ai-smoke-board-${finishedAt.replace(/[:.]/g, '-')}.json`,
      );
      writeFileSync(
        file,
        `${JSON.stringify(
          {
            finishedAt,
            mode: 'board-context',
            model: provider.model,
            baseUrlHost: host,
            reasoningEffort: config.LLM_REASONING_EFFORT,
            board: board.key,
            contextTokens: config.LLM_CONTEXT_TOKENS,
            estimatedPromptTokens: first.estimatedTokens,
            promptChars,
            delayMs: options.delayMs,
            toolChoice: options.toolChoice,
            ttftTargetMs: TTFT_TARGET_MS,
            percentileMethod: 'nearest-rank',
            summary: { ttft: ttftSummary, total: totalSummary, shareTtftBelowTarget: below },
            coldStart,
            runs,
          },
          null,
          2,
        )}\n`,
      );
      console.info(`Results written to ${file}`);
    }
    if (ok.length < runs.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (options.boardContext) {
    await runBoardContext(options);
    return;
  }
  // The flag goes through the same validation as the environment variable.
  const config = loadAiConfig(
    options.reasoning === undefined
      ? process.env
      : { ...process.env, LLM_REASONING_EFFORT: options.reasoning },
  );
  const reasoningEffort = config.LLM_REASONING_EFFORT;
  if (!config.AI_ENABLED) {
    throw new Error(
      'The AI assistant is disabled. Set AI_ENABLED=true, LLM_BASE_URL and LLM_MODEL ' +
        '(apps/api/.env or the environment), e.g. LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen3.5:9b.',
    );
  }

  // The recorder of the call in progress receives the provider's stream diagnostics.
  let recorder = new RunRecorder(() => performance.now());
  const provider = createLlmProvider(config, {
    onDiagnostic: (diagnostic) => recorder.onDiagnostic(diagnostic),
  });
  if (!provider) throw new Error('The AI provider could not be created');
  const host = new URL(config.LLM_BASE_URL ?? '').host;

  console.info(
    `Model: ${provider.model} at ${host}; reasoning_effort: ${reasoningEffort}; ${String(options.runs)} measured runs.`,
  );

  const ask = async (llm: LlmProvider, text: string): Promise<RunMetrics> => {
    recorder = new RunRecorder(() => performance.now());
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ];
    await collectResponse(llm.streamChat({ messages }), (event) => recorder.onEvent(event));
    return recorder.finish();
  };

  let coldStart: RunMetrics | null = null;
  if (options.warmup) {
    console.info('Warm-up call (not measured)…');
    try {
      coldStart = await ask(provider, 'Hi');
    } catch (err) {
      throw new Error(`Warm-up failed: ${describeError(err)}`, { cause: err });
    }
  }

  const runs: PlainRun[] = [];
  for (let index = 0; index < options.runs; index += 1) {
    if (index > 0) await sleep(options.delayMs);
    const prompt = PROMPTS[index % PROMPTS.length] ?? { lang: 'en', text: 'Hello' };
    try {
      runs.push({
        run: index + 1,
        lang: prompt.lang,
        error: null,
        ...(await ask(provider, prompt.text)),
      });
    } catch (err) {
      if (isFatal(err)) throw new Error(describeError(err), { cause: err });
      runs.push({
        run: index + 1,
        lang: prompt.lang,
        error: describeError(err),
        ...recorder.finish(),
      });
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  await sleep(options.delayMs);
  recorder = new RunRecorder(() => performance.now());
  let toolRun: ToolRun;
  try {
    const result = await runWithValidation({
      provider,
      request: {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: TOOL_PROMPT },
        ],
        tools: [
          {
            name: 'create_card',
            description: 'Creates a card on the current board.',
            parameters: z.toJSONSchema(createCardArgsSchema),
          },
        ],
      },
      schema: createCardArgsSchema,
      extract: toolCallArguments('create_card'),
      onEvent: (event) => recorder.onEvent(event),
    });
    toolRun = {
      ...recorder.finish(),
      valid: true,
      attempts: result.attempts,
      arguments: result.value,
      error: null,
    };
  } catch (err) {
    toolRun = {
      ...recorder.finish(),
      valid: false,
      attempts: null,
      arguments: null,
      error: describeError(err),
    };
  }

  console.info(
    formatTable(
      [
        'run',
        'lang',
        'TTFT',
        'first reasoning',
        'total',
        'prompt tok',
        'completion tok',
        'reasoning chunks',
        'finish',
      ],
      runs.map((run) => [
        String(run.run),
        run.lang,
        formatMs(run.ttftMs),
        formatMs(run.firstReasoningMs),
        formatMs(run.totalMs),
        run.promptTokens === null ? '-' : String(run.promptTokens),
        run.completionTokens === null ? '-' : String(run.completionTokens),
        String(run.reasoningChunks),
        run.error ?? run.finishReason ?? '-',
      ]),
    ),
  );

  const ttfts = runs.flatMap((run) => (run.ttftMs === null ? [] : [run.ttftMs]));
  const totals = runs.map((run) => run.totalMs);
  const ttftSummary = summarize(ttfts);
  const totalSummary = summarize(totals);
  const below = shareBelow(ttfts, TTFT_TARGET_MS);
  const reasoningChunks = runs.reduce((sum, run) => sum + run.reasoningChunks, 0);
  const failed = runs.filter((run) => run.error !== null).length;

  console.info('');
  console.info(
    formatTable(
      ['metric', 'n', 'min', 'median', 'p95', 'max'],
      [summaryRow('TTFT', ttftSummary), summaryRow('total', totalSummary)],
    ),
  );
  console.info('');
  console.info(`Model:            ${provider.model}`);
  console.info(
    `reasoning_effort: ${reasoningEffort}${reasoningEffort === 'default' ? ' (not sent)' : ''}`,
  );
  console.info(`Base URL host:    ${host}`);
  console.info(`Runs:             ${String(runs.length)} (${String(failed)} failed)`);
  console.info(
    `TTFT < 3 s:       ${below === null ? '-' : `${(below * 100).toFixed(0)}%`} of runs (WNF-09 target: p95 < 3 s → ${
      ttftSummary === null ? 'n/a' : ttftSummary.p95 < TTFT_TARGET_MS ? 'MET' : 'NOT MET'
    })`,
  );
  console.info(`Reasoning chunks: ${String(reasoningChunks)} in total`);
  if (coldStart) {
    console.info(
      `Warm-up (cold):   TTFT ${formatMs(coldStart.ttftMs)}, total ${formatMs(coldStart.totalMs)}`,
    );
  }
  console.info(
    `Tool call:        ${
      toolRun.valid
        ? `valid on attempt ${String(toolRun.attempts)} → ${JSON.stringify(toolRun.arguments)}`
        : `INVALID (${toolRun.error ?? 'unknown error'})`
    }; TTFT ${formatMs(toolRun.ttftMs)}, total ${formatMs(toolRun.totalMs)}`,
  );

  if (options.json) {
    const finishedAt = new Date().toISOString();
    const file = join(
      process.env.INIT_CWD ?? process.cwd(),
      `ai-smoke-${finishedAt.replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          finishedAt,
          model: provider.model,
          baseUrlHost: host,
          reasoningEffort,
          ttftTargetMs: TTFT_TARGET_MS,
          percentileMethod: 'nearest-rank',
          summary: {
            ttft: ttftSummary,
            total: totalSummary,
            shareTtftBelowTarget: below,
            reasoningChunks,
          },
          coldStart,
          runs,
          toolRun,
        },
        null,
        2,
      )}\n`,
    );
    console.info(`Results written to ${file}`);
  }

  if (failed > 0 || !toolRun.valid) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
