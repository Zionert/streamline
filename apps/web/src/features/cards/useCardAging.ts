import { MS_PER_DAY, type CardAgingItem } from '@streamline/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBoardChangeRefresh, type BoardChange } from '@/features/realtime/boardChanges';

import * as agingApi from './agingApi';

/** Quiet time after the last relevant board change before the ages are read again. */
export const AGING_REFRESH_DELAY_MS = 1500;

/** How often the ages shown are recomputed from the start of the cards' cycles. */
export const AGING_TICK_MS = 60_000;

/** Live events after which cards may have started or stopped aging. */
const AGING_EVENTS: ReadonlySet<string> = new Set([
  'card:created',
  'card:moved',
  'card:updated',
  'card:deleted',
  'column:updated',
  'column:deleted',
]);

/** Own changes after which cards may have started or stopped aging. */
const AGING_LOCAL_KINDS: ReadonlySet<string> = new Set(['card-moved', 'column-settings']);

function isAgingChange(change: BoardChange): boolean {
  switch (change.type) {
    case 'remote':
      return AGING_EVENTS.has(change.event.name);
    case 'local':
      // Created and edited cards cannot have started aging, and deleted ones (also with their
      // column) leave the board at once.
      return AGING_LOCAL_KINDS.has(change.kind);
    case 'rejoined':
      return true;
  }
}

export type CardAgingById = ReadonlyMap<string, CardAgingItem>;

const NO_AGING: CardAgingById = new Map();

interface AgingState {
  boardId: string;
  aging: CardAgingById;
}

/**
 * The aging cards of the board (in progress for longer than the board's usual cycle time), by
 * card id. Read when the board opens and again, debounced, after card moves (local and remote),
 * other card changes, column changes and a reconnect, so new aging cards appear and ages stay
 * fresh. A response to an earlier request (or for another board) is dropped. The badge is an
 * extra: a failed request keeps the last known ages and is not reported.
 *
 * Whether a card is still in progress is up to the caller (its current column), so a card moved
 * out of an IN_PROGRESS column loses its badge at once, before the ages are read again.
 *
 * The server decides which cards are aging (`isAging`); the age shown is counted here from the
 * start of the card's cycle and recomputed every minute, so it grows on a board left open.
 */
export function useCardAging(boardId: string): CardAgingById {
  const [state, setState] = useState<AgingState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef<{ generation: number; controller: AbortController | null }>({
    generation: 0,
    controller: null,
  });

  const fetchAging = useCallback(() => {
    const guard = latest.current;
    guard.controller?.abort();
    const controller = new AbortController();
    const generation = ++guard.generation;
    guard.controller = controller;
    agingApi.getCardAging(boardId, controller.signal).then(
      (response) => {
        if (generation !== guard.generation) {
          return;
        }
        const aging = new Map(
          response.items.filter((item) => item.isAging).map((item) => [item.cardId, item]),
        );
        setState({ boardId, aging });
        setNow(Date.now());
      },
      () => {
        // Kept as it was: the badge is not essential and the next change reads the ages again.
      },
    );
  }, [boardId]);

  useEffect(() => {
    if (boardId === '') {
      return;
    }
    const guard = latest.current;
    fetchAging();
    return () => {
      // Another board (or none): whatever is still in flight belongs to the previous one.
      guard.generation += 1;
      guard.controller?.abort();
      guard.controller = null;
    };
  }, [boardId, fetchAging]);

  useBoardChangeRefresh(boardId, {
    isRelevant: isAgingChange,
    delayMs: AGING_REFRESH_DELAY_MS,
    refresh: fetchAging,
  });

  const current = state?.boardId === boardId ? state.aging : NO_AGING;
  const hasAging = current.size > 0;
  useEffect(() => {
    if (!hasAging) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), AGING_TICK_MS);
    return () => clearInterval(timer);
  }, [hasAging]);

  return useMemo(() => {
    if (current.size === 0) {
      return current;
    }
    return new Map(
      [...current].map(([cardId, item]) => [
        cardId,
        { ...item, ageDays: ageInDays(item.cycleStartedAt, now) },
      ]),
    );
  }, [current, now]);
}

/** Days from `cycleStartedAt` to `now` (never negative, e.g. with a clock behind the server's). */
function ageInDays(cycleStartedAt: string, now: number): number {
  return Math.max(0, (now - Date.parse(cycleStartedAt)) / MS_PER_DAY);
}
