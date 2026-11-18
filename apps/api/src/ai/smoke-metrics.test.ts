import { describe, expect, it } from 'vitest';

import {
  RunRecorder,
  formatMs,
  formatTable,
  median,
  percentile,
  shareBelow,
  summarize,
} from './smoke-metrics.js';

/** A clock returning the given times one by one. */
function steppingClock(...times: number[]): () => number {
  let index = 0;
  return () => {
    const time = times[Math.min(index, times.length - 1)] ?? 0;
    index += 1;
    return time;
  };
}

describe('percentile (nearest rank)', () => {
  it('returns one of the measured values', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];

    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 90)).toBe(9);
    expect(percentile(values, 100)).toBe(10);
  });

  it('equals the maximum for fewer than 20 values at p95', () => {
    expect(percentile([3, 1, 2], 95)).toBe(3);
    expect(
      percentile(
        Array.from({ length: 19 }, (_, i) => i + 1),
        95,
      ),
    ).toBe(19);
  });

  it('picks the 19th of 20 values at p95', () => {
    expect(
      percentile(
        Array.from({ length: 20 }, (_, i) => i + 1),
        95,
      ),
    ).toBe(19);
  });

  it('handles a single value, no values and an invalid percentile', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBeNull();
    expect(() => percentile([1], 0)).toThrow(RangeError);
  });
});

describe('median, summarize and shareBelow', () => {
  it('averages the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('summarizes latencies', () => {
    expect(summarize([1200, 800, 4000, 1000, 900])).toEqual({
      count: 5,
      min: 800,
      median: 1000,
      p95: 4000,
      max: 4000,
    });
    expect(summarize([])).toBeNull();
  });

  it('computes the share strictly below a threshold', () => {
    expect(shareBelow([1000, 2999, 3000, 5000], 3000)).toBe(0.5);
    expect(shareBelow([], 3000)).toBeNull();
  });
});

describe('RunRecorder', () => {
  it('measures TTFT to the first non-empty text, not to reasoning', () => {
    // start, reasoning, empty text (no clock read), text, finish
    const recorder = new RunRecorder(steppingClock(100, 400, 2600, 3100));

    recorder.onDiagnostic({ type: 'reasoning-delta' });
    recorder.onEvent({ type: 'text-delta', text: '' });
    recorder.onEvent({ type: 'text-delta', text: 'Hello' });
    recorder.onEvent({ type: 'text-delta', text: '!' });
    recorder.onEvent({ type: 'usage', promptTokens: 10, completionTokens: 5 });
    recorder.onEvent({ type: 'done', finishReason: 'stop' });

    expect(recorder.finish()).toEqual({
      ttftMs: 2500,
      firstReasoningMs: 300,
      totalMs: 3000,
      promptTokens: 10,
      completionTokens: 5,
      reasoningChunks: 1,
      textLength: 6,
      toolCalls: 0,
      finishReason: 'stop',
    });
  });

  it('measures TTFT to the first tool call fragment when the answer starts with a tool call', () => {
    // start, tool-call fragment, finish
    const recorder = new RunRecorder(steppingClock(0, 700, 900));

    recorder.onDiagnostic({ type: 'tool-call-delta' });
    recorder.onDiagnostic({ type: 'tool-call-delta' });
    recorder.onEvent({ type: 'tool-call', id: 'a', name: 'f', argumentsJson: '{}' });
    recorder.onEvent({ type: 'done', finishReason: 'tool_calls' });

    expect(recorder.finish()).toMatchObject({ ttftMs: 700, totalMs: 900, toolCalls: 1 });
  });

  it('falls back to the assembled tool call without fragment diagnostics', () => {
    const recorder = new RunRecorder(steppingClock(0, 250, 300));

    recorder.onEvent({ type: 'tool-call', id: 'a', name: 'f', argumentsJson: '{}' });

    expect(recorder.finish()).toMatchObject({ ttftMs: 250, totalMs: 300 });
  });

  it('reports no TTFT for an empty answer', () => {
    const recorder = new RunRecorder(steppingClock(0, 50));
    recorder.onEvent({ type: 'done', finishReason: 'other' });

    expect(recorder.finish()).toMatchObject({ ttftMs: null, firstReasoningMs: null, totalMs: 50 });
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatMs(850.4)).toBe('850 ms');
    expect(formatMs(1234)).toBe('1.23 s');
    expect(formatMs(null)).toBe('-');
  });

  it('pads table columns to the widest cell', () => {
    expect(
      formatTable(
        ['run', 'TTFT'],
        [
          ['1', '1.20 s'],
          ['10', '-'],
        ],
      ),
    ).toBe(['run  TTFT', '---  ------', '1    1.20 s', '10   -'].join('\n'));
  });
});
