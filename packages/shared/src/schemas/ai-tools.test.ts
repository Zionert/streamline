import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AI_SEARCH_CARDS_MAX_LIMIT,
  aiBoardOverviewArgsSchema,
  aiFlowMetricsArgsSchema,
  aiForecastArgsSchema,
  aiGetCardArgsSchema,
  aiSearchCardsArgsSchema,
} from './ai-tools.js';

const ALL_SCHEMAS = [
  aiBoardOverviewArgsSchema,
  aiSearchCardsArgsSchema,
  aiGetCardArgsSchema,
  aiFlowMetricsArgsSchema,
  aiForecastArgsSchema,
];

describe('AI board tool arguments', () => {
  it('never accept a board id (strict objects)', () => {
    for (const schema of ALL_SCHEMAS) {
      expect(schema.safeParse({ boardId: 'other-board' }).success).toBe(false);
      const json = JSON.stringify(z.toJSONSchema(schema, { io: 'input' }));
      expect(json).toContain('"additionalProperties":false');
      expect(json).not.toMatch(/board/i);
    }
  });

  it('accept the documented search filters', () => {
    expect(
      aiSearchCardsArgsSchema.parse({
        query: ' login ',
        column: 'To Do',
        assignee: 'me',
        label: 'Bug',
        limit: AI_SEARCH_CARDS_MAX_LIMIT,
      }),
    ).toMatchObject({ query: 'login', limit: AI_SEARCH_CARDS_MAX_LIMIT });
    expect(aiSearchCardsArgsSchema.parse({})).toEqual({});
  });

  it.each([{ limit: 0 }, { limit: AI_SEARCH_CARDS_MAX_LIMIT + 1 }, { limit: 2.5 }, { query: ' ' }])(
    'rejects search arguments %o',
    (args) => {
      expect(aiSearchCardsArgsSchema.safeParse(args).success).toBe(false);
    },
  );

  it('normalizes card keys and rejects other values', () => {
    expect(aiGetCardArgsSchema.parse({ key: ' sl-12 ' })).toEqual({ key: 'SL-12' });
    for (const key of ['12', 'SL-0', 'S-1', 'SL 12', '']) {
      expect(aiGetCardArgsSchema.safeParse({ key }).success).toBe(false);
    }
  });

  it('bounds the flow metrics range', () => {
    expect(aiFlowMetricsArgsSchema.parse({ days: 7 })).toEqual({ days: 7 });
    expect(aiFlowMetricsArgsSchema.safeParse({ days: 6 }).success).toBe(false);
    expect(aiFlowMetricsArgsSchema.safeParse({ days: 181 }).success).toBe(false);
  });

  it('takes either remaining or a target date for the forecast', () => {
    expect(aiForecastArgsSchema.parse({})).toEqual({});
    expect(aiForecastArgsSchema.parse({ remaining: 12 })).toEqual({ remaining: 12 });
    expect(aiForecastArgsSchema.parse({ targetDate: '2026-12-31' })).toEqual({
      targetDate: '2026-12-31',
    });
    expect(aiForecastArgsSchema.safeParse({ remaining: 1, targetDate: '2026-12-31' }).success).toBe(
      false,
    );
    expect(aiForecastArgsSchema.safeParse({ targetDate: '31.12.2026' }).success).toBe(false);
    expect(aiForecastArgsSchema.safeParse({ remaining: 0 }).success).toBe(false);
  });
});
