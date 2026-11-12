import type { PresenceUser } from '@streamline/shared';
import { describe, expect, it } from 'vitest';

import { createPresenceTracker } from './presence.js';

function user(id: string): PresenceUser {
  return { id, name: id };
}

const ann = user('ann');
const bob = user('bob');

describe('presence tracker', () => {
  it('lists users in the order they arrived', () => {
    const presence = createPresenceTracker();

    expect(presence.join('b1', 's1', ann)).toBe(true);
    expect(presence.join('b1', 's2', bob)).toBe(true);

    expect(presence.list('b1')).toEqual([ann, bob]);
    expect(presence.list('other')).toEqual([]);
  });

  it('counts a user with several sockets once', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);

    expect(presence.join('b1', 's2', ann)).toBe(false);
    expect(presence.list('b1')).toEqual([ann]);

    expect(presence.leave('b1', 's1')).toBe(false);
    expect(presence.list('b1')).toEqual([ann]);
    expect(presence.leave('b1', 's2')).toBe(true);
    expect(presence.list('b1')).toEqual([]);
  });

  it('ignores leaving a board the socket is not on', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);

    expect(presence.leave('b2', 's1')).toBe(false);
    expect(presence.leave('b1', 's9')).toBe(false);
    expect(presence.list('b1')).toEqual([ann]);
  });

  it('treats a repeated join of the same socket as a no-op', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);

    expect(presence.join('b1', 's1', ann)).toBe(false);
    expect(presence.leave('b1', 's1')).toBe(true);
  });

  it('removes a disconnected socket from all its boards', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);
    presence.join('b2', 's1', ann);
    presence.join('b2', 's2', ann);
    presence.join('b3', 's3', bob);

    expect(presence.leaveAll('s1').sort()).toEqual(['b1']);
    expect(presence.list('b1')).toEqual([]);
    expect(presence.list('b2')).toEqual([ann]);
    expect(presence.list('b3')).toEqual([bob]);
    expect(presence.leaveAll('s1')).toEqual([]);
  });

  it('removes all sockets of a user from a board', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);
    presence.join('b1', 's2', ann);
    presence.join('b1', 's3', bob);
    presence.join('b2', 's1', ann);

    expect(presence.removeUser('b1', 'ann')).toBe(true);
    expect(presence.removeUser('b1', 'ann')).toBe(false);
    expect(presence.list('b1')).toEqual([bob]);
    expect(presence.list('b2')).toEqual([ann]);
    // The socket is still tracked on the other board only.
    expect(presence.leaveAll('s1')).toEqual(['b2']);
  });

  it('forgets a deleted board', () => {
    const presence = createPresenceTracker();
    presence.join('b1', 's1', ann);
    presence.join('b2', 's1', ann);

    presence.clearBoard('b1');
    presence.clearBoard('missing');

    expect(presence.list('b1')).toEqual([]);
    expect(presence.leaveAll('s1')).toEqual(['b2']);
  });
});
