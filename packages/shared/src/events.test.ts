import { describe, expect, it } from 'vitest';

import { WS_EVENTS, boardRoom } from './events.js';

describe('WS_EVENTS', () => {
  it('uses unique "<entity>:<action>" event names', () => {
    const names = Object.values(WS_EVENTS);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });
});

describe('boardRoom', () => {
  it('builds the board room name', () => {
    expect(boardRoom('abc')).toBe('board:abc');
  });
});
