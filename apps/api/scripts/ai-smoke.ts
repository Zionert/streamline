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
import type { LlmMessage, LlmProvider } from '../src/ai/llm-provider.js';
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
import { loadAiConfig } from '../src/config/env.js';

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

function parseOptions() {
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '10' },
      reasoning: { type: 'string' },
      warmup: { type: 'boolean', default: true },
      json: { type: 'boolean', default: false },
    },
    allowNegative: true,
  });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 1000) {
    throw new Error('--runs must be an integer between 1 and 1000');
  }
  return { runs, warmup: values.warmup, json: values.json, reasoning: values.reasoning };
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

async function main(): Promise<void> {
  const options = parseOptions();
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
