import type { PresenceUser } from '@streamline/shared';
import { useMemo } from 'react';

import { AvatarStack, type AvatarStackPerson } from '@/components/ui/avatar';

/** Avatars shown before the "+N" counter. */
export const PRESENCE_MAX_VISIBLE = 4;

interface BoardPresenceProps {
  /** Users currently viewing the board (the current user included), each once. */
  users: readonly PresenceUser[];
}

/** Who is looking at the board right now: small overlapping avatars with names as tooltips. */
export function BoardPresence({ users }: BoardPresenceProps) {
  const people = useMemo<AvatarStackPerson[]>(
    () => users.map((user) => ({ userId: user.id, name: user.name })),
    [users],
  );
  if (people.length === 0) {
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-subtle">Viewing now</span>
      <AvatarStack
        people={people}
        max={PRESENCE_MAX_VISIBLE}
        size="sm"
        label="Users viewing this board"
      />
    </div>
  );
}
