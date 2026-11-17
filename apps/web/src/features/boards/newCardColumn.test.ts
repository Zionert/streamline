import { describe, expect, it } from 'vitest';

import { columnWith } from '@/test/fixtures';

import { newCardColumn } from './newCardColumn';

describe('newCardColumn', () => {
  it('picks the first TODO column in rank order', () => {
    const columns = [
      columnWith({ id: 'backlog', rank: 'a', category: 'BACKLOG' }),
      columnWith({ id: 'todo-1', rank: 'b', category: 'TODO' }),
      columnWith({ id: 'todo-2', rank: 'c', category: 'TODO' }),
    ];

    expect(newCardColumn(columns)?.id).toBe('todo-1');
  });

  it('falls back to the first column without a TODO column', () => {
    const columns = [
      columnWith({ id: 'backlog', rank: 'a', category: 'BACKLOG' }),
      columnWith({ id: 'done', rank: 'b', category: 'DONE' }),
    ];

    expect(newCardColumn(columns)?.id).toBe('backlog');
  });

  it('has no target on a board without columns', () => {
    expect(newCardColumn([])).toBeNull();
  });
});
