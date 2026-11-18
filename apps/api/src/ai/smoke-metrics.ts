import type { LlmEvent, LlmFinishReason } from './llm-provider.js';
import type { LlmStreamDiagnostic } from './openai-stream.js';

/**
 * Measurements of the model smoke test (`pnpm ai:smoke`), kept free of I/O so they can be tested.
 *
 * Time to first token (TTFT) = time from sending the request to the first fragment of the answer
 * the user would see: the first non-empty text delta or, when the answer starts with a tool call,
 * the first tool call fragment in the stream (or the assembled tool call, for providers that do
 * not expose fragments). Reasoning ("thinking") tokens are not part of the answer and do not stop
 * the clock; the time to the first of them is reported separately.
 */

export interface RunMetrics {
  /** `null` when the response contained neither text nor a tool call. */
  ttftMs: number | null;
  firstReasoningMs: number | null;
  totalMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningChunks: number;
  textLength: number;
  toolCalls: number;
  finishReason: LlmFinishReason | null;
}

/** Collects the metrics of one model call; `now` is a millisecond clock (e.g. `performance.now`). */
export class RunRecorder {
  private readonly startedAt: number;
  private firstOutputAt: number | null = null;
  private firstReasoningAt: number | null = null;
  private metrics: Omit<RunMetrics, 'ttftMs' | 'firstReasoningMs' | 'totalMs'> = {
    promptTokens: null,
    completionTokens: null,
    reasoningChunks: 0,
    textLength: 0,
    toolCalls: 0,
    finishReason: null,
  };

  constructor(private readonly now: () => number) {
    this.startedAt = now();
  }

  onDiagnostic(diagnostic: LlmStreamDiagnostic): void {
    if (diagnostic.type === 'reasoning-delta') {
      this.metrics.reasoningChunks += 1;
      this.firstReasoningAt ??= this.now();
    } else {
      this.firstOutputAt ??= this.now();
    }
  }

  onEvent(event: LlmEvent): void {
    switch (event.type) {
      case 'text-delta':
        if (event.text === '') return;
        this.firstOutputAt ??= this.now();
        this.metrics.textLength += event.text.length;
        break;
      case 'tool-call':
        this.firstOutputAt ??= this.now();
        this.metrics.toolCalls += 1;
        break;
      case 'usage':
        this.metrics.promptTokens = event.promptTokens;
        this.metrics.completionTokens = event.completionTokens;
        break;
      case 'done':
        this.metrics.finishReason = event.finishReason;
        break;
    }
  }

  finish(): RunMetrics {
    return {
      ttftMs: this.firstOutputAt === null ? null : this.firstOutputAt - this.startedAt,
      firstReasoningMs:
        this.firstReasoningAt === null ? null : this.firstReasoningAt - this.startedAt,
      totalMs: this.now() - this.startedAt,
      ...this.metrics,
    };
  }
}

/**
 * Nearest-rank percentile: the smallest value with at least `p`% of the values at or below it.
 * Always one of the measured values; with fewer than 20 values the 95th percentile is the maximum.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p <= 0 || p > 100) throw new RangeError('The percentile must be in (0, 100]');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] ?? null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export interface LatencySummary {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
}

export function summarize(values: readonly number[]): LatencySummary | null {
  if (values.length === 0) return null;
  return {
    count: values.length,
    min: Math.min(...values),
    median: median(values) ?? 0,
    p95: percentile(values, 95) ?? 0,
    max: Math.max(...values),
  };
}

/** Share (0–1) of the values strictly below the threshold. */
export function shareBelow(values: readonly number[], threshold: number): number | null {
  if (values.length === 0) return null;
  return values.filter((value) => value < threshold).length / values.length;
}

/** `850 ms`, `1.24 s`, or `-` when unknown. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  return ms < 1000 ? `${String(Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** A plain-text table with columns padded to their widest cell. */
export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]) =>
    widths
      .map((width, column) => (cells[column] ?? '').padEnd(width))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join(
    '\n',
  );
}
