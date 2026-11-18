import { describe, expect, it } from 'vitest';

import { at, flowCard } from '../../test-utils/flow.js';
import { deriveCardFlow, sortTransitions } from './card-flow.js';
import { FlowError, MS_PER_DAY } from './errors.js';

describe('deriveCardFlow', () => {
  it('computes lead and cycle time of a simple card', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'BACKLOG'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-05T12:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.currentCategory).toBe('DONE');
    expect(flow.completedAt).toEqual(at('2026-01-05T12:00:00Z'));
    expect(flow.cycleStartedAt).toEqual(at('2026-01-02T00:00:00Z'));
    expect(flow.leadTimeMs).toBe(4.5 * MS_PER_DAY);
    expect(flow.leadTimeDays).toBe(4.5);
    expect(flow.cycleTimeMs).toBe(3.5 * MS_PER_DAY);
    expect(flow.cycleTimeDays).toBe(3.5);
    expect(flow.neverLeftDone).toBe(false);
  });

  it('reopened card uses the last entry into DONE and the first entry into IN_PROGRESS', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'TODO'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-03T00:00:00Z', 'DONE'],
        ['2026-01-04T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-06T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.completedAt).toEqual(at('2026-01-06T00:00:00Z'));
    expect(flow.cycleStartedAt).toEqual(at('2026-01-02T00:00:00Z'));
    expect(flow.leadTimeDays).toBe(5);
    expect(flow.cycleTimeDays).toBe(4);
  });

  it('moving between two DONE columns is not a new completion', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-02T00:00:00Z', 'DONE'],
        ['2026-01-03T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.completedAt).toEqual(at('2026-01-02T00:00:00Z'));
    expect(flow.leadTimeDays).toBe(1);
  });

  it('reopened card currently outside DONE is not completed but keeps its cycle start', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'TODO'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-03T00:00:00Z', 'DONE'],
        ['2026-01-04T00:00:00Z', 'IN_PROGRESS'],
      ]),
    );
    expect(flow.currentCategory).toBe('IN_PROGRESS');
    expect(flow.completedAt).toBeNull();
    expect(flow.leadTimeMs).toBeNull();
    expect(flow.cycleTimeMs).toBeNull();
    expect(flow.cycleStartedAt).toEqual(at('2026-01-02T00:00:00Z'));
  });

  it('card created in IN_PROGRESS starts its cycle at creation', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T08:00:00Z', 'IN_PROGRESS'],
        ['2026-01-03T08:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.cycleStartedAt).toEqual(at('2026-01-01T08:00:00Z'));
    expect(flow.cycleTimeDays).toBe(2);
    expect(flow.leadTimeDays).toBe(2);
  });

  it('card never in IN_PROGRESS has a lead time but no cycle time', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'TODO'],
        ['2026-01-02T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.completedAt).toEqual(at('2026-01-02T00:00:00Z'));
    expect(flow.leadTimeDays).toBe(1);
    expect(flow.cycleStartedAt).toBeNull();
    expect(flow.cycleTimeMs).toBeNull();
    expect(flow.cycleTimeDays).toBeNull();
  });

  it('card created in DONE that never left is completed but has neither lead nor cycle time', () => {
    const flow = deriveCardFlow(flowCard('c1', [['2026-01-01T00:00:00Z', 'DONE']]));
    expect(flow.neverLeftDone).toBe(true);
    expect(flow.completedAt).toEqual(at('2026-01-01T00:00:00Z'));
    expect(flow.leadTimeMs).toBeNull();
    expect(flow.cycleTimeMs).toBeNull();
  });

  it('moving between DONE columns still counts as never having left DONE', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'DONE'],
        ['2026-01-03T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.neverLeftDone).toBe(true);
    expect(flow.completedAt).toEqual(at('2026-01-01T00:00:00Z'));
    expect(flow.leadTimeMs).toBeNull();
    expect(flow.cycleTimeMs).toBeNull();
  });

  it('card created in DONE, reopened to IN_PROGRESS and completed is a normal card', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'DONE'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-03T00:00:00Z', 'DONE'],
        ['2026-01-04T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-06T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.neverLeftDone).toBe(false);
    expect(flow.completedAt).toEqual(at('2026-01-06T00:00:00Z'));
    expect(flow.cycleStartedAt).toEqual(at('2026-01-02T00:00:00Z'));
    expect(flow.leadTimeDays).toBe(5);
    expect(flow.cycleTimeDays).toBe(4);
  });

  it('card created in DONE, reopened to TODO and completed has a lead but no cycle time', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'DONE'],
        ['2026-01-02T00:00:00Z', 'TODO'],
        ['2026-01-04T00:00:00Z', 'DONE'],
      ]),
    );
    expect(flow.neverLeftDone).toBe(false);
    expect(flow.leadTimeDays).toBe(3);
    expect(flow.cycleStartedAt).toBeNull();
    expect(flow.cycleTimeDays).toBeNull();
  });

  it('card created in DONE and currently reopened is not completed', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'DONE'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
      ]),
    );
    expect(flow.neverLeftDone).toBe(false);
    expect(flow.completedAt).toBeNull();
    expect(flow.leadTimeMs).toBeNull();
  });

  it('unknown category (deleted column) is neither completed nor in progress', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-02T00:00:00Z', 'DONE'],
        ['2026-01-03T00:00:00Z', null],
      ]),
    );
    expect(flow.currentCategory).toBeNull();
    expect(flow.completedAt).toBeNull();
    expect(flow.leadTimeMs).toBeNull();
  });

  it('card without transitions has an unknown category', () => {
    const flow = deriveCardFlow({ cardId: 'c1', createdAt: at('2026-01-01'), transitions: [] });
    expect(flow.currentCategory).toBeNull();
    expect(flow.completedAt).toBeNull();
    expect(flow.neverLeftDone).toBe(false);
  });

  it('sorts unsorted transitions without mutating the input', () => {
    const card = flowCard(
      'c1',
      [
        ['2026-01-05T00:00:00Z', 'DONE'],
        ['2026-01-01T00:00:00Z', 'TODO'],
        ['2026-01-03T00:00:00Z', 'IN_PROGRESS'],
      ],
      '2026-01-01T00:00:00Z',
    );
    const original = [...card.transitions];
    const flow = deriveCardFlow(card);
    expect(card.transitions).toEqual(original);
    expect(flow.currentCategory).toBe('DONE');
    expect(flow.neverLeftDone).toBe(false);
    expect(flow.leadTimeDays).toBe(4);
    expect(flow.cycleTimeDays).toBe(2);
  });

  it('clamps durations to 0 when transitions precede createdAt', () => {
    const flow = deriveCardFlow(
      flowCard(
        'c1',
        [
          ['2026-01-01T00:00:00Z', 'IN_PROGRESS'],
          ['2026-01-01T00:00:01Z', 'DONE'],
        ],
        '2026-01-01T00:00:05Z',
      ),
    );
    expect(flow.createdAt).toEqual(at('2026-01-01T00:00:05Z'));
    expect(flow.leadTimeMs).toBe(0);
    expect(flow.cycleTimeMs).toBe(1000);
  });

  it('throws INVALID_ARGUMENT for invalid dates and categories', () => {
    const invalid = new Date('nope');
    expect(() => deriveCardFlow({ cardId: 'c', createdAt: invalid, transitions: [] })).toThrow(
      FlowError,
    );
    try {
      deriveCardFlow({
        cardId: 'c',
        createdAt: at('2026-01-01'),
        transitions: [{ at: invalid, toCategory: 'TODO' }],
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FlowError);
      expect((error as FlowError).code).toBe('INVALID_ARGUMENT');
    }
    expect(() =>
      deriveCardFlow({
        cardId: 'c',
        createdAt: at('2026-01-01'),
        transitions: [{ at: at('2026-01-01'), toCategory: 'ARCHIVED' as never }],
      }),
    ).toThrow(FlowError);
  });
});

describe('sortTransitions', () => {
  it('is stable for equal instants', () => {
    const t = at('2026-01-01T00:00:00Z');
    const sorted = sortTransitions([
      { at: t, toCategory: 'TODO' },
      { at: t, toCategory: 'IN_PROGRESS' },
      { at: at('2025-12-31T00:00:00Z'), toCategory: 'BACKLOG' },
    ]);
    expect(sorted.map((s) => s.toCategory)).toEqual(['BACKLOG', 'TODO', 'IN_PROGRESS']);
  });
});

describe('deriveCardFlow on its own result', () => {
  it('returns a derived flow unchanged and freezes it', () => {
    const flow = deriveCardFlow(
      flowCard('c1', [
        ['2026-01-01T00:00:00Z', 'TODO'],
        ['2026-01-02T00:00:00Z', 'IN_PROGRESS'],
        ['2026-01-04T00:00:00Z', 'DONE'],
      ]),
    );
    expect(deriveCardFlow(flow)).toBe(flow);
    expect(Object.isFrozen(flow)).toBe(true);
    expect(Object.isFrozen(flow.transitions)).toBe(true);
  });

  it('derives a structurally equal copy again', () => {
    const flow = deriveCardFlow(flowCard('c1', [['2026-01-01T00:00:00Z', 'TODO']]));
    const copy = { cardId: flow.cardId, createdAt: flow.createdAt, transitions: flow.transitions };
    const again = deriveCardFlow(copy);
    expect(again).not.toBe(flow);
    expect(again).toEqual(flow);
  });
});
