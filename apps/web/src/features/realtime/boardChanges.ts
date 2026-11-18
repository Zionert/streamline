import type { BoardEvent } from '@streamline/shared';
import { useEffect, useRef } from 'react';

/**
 * A change of the opened board that data derived on the server (e.g. flow analytics) may depend
 * on:
 * - `remote` — a change made by someone else, received live and already applied to the store,
 * - `local` — a change made here and confirmed by the server (the server does not echo it back),
 * - `rejoined` — the board's room was joined again after a reconnect; changes made while
 *   disconnected were missed.
 */
export type BoardChange =
  | { type: 'remote'; event: BoardEvent }
  | { type: 'local'; kind: LocalBoardChangeKind }
  | { type: 'rejoined' };

/** A change made here: what kind of entity changed, and how. */
export type LocalBoardChangeKind =
  | 'card-created'
  | 'card-updated'
  | 'card-moved'
  | 'card-deleted'
  | 'column-created'
  | 'column-moved'
  | 'column-settings'
  | 'column-deleted';

type Listener = (change: BoardChange) => void;

const listeners = new Map<string, Set<Listener>>();

/** Notifies the subscribers of `boardId`. */
export function publishBoardChange(boardId: string, change: BoardChange): void {
  for (const listener of [...(listeners.get(boardId) ?? [])]) {
    listener(change);
  }
}

/** Calls `listener` for every change of `boardId`; returns the unsubscribe function. */
export function subscribeBoardChanges(boardId: string, listener: Listener): () => void {
  let set = listeners.get(boardId);
  if (!set) {
    set = new Set();
    listeners.set(boardId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(boardId);
    current?.delete(listener);
    if (current?.size === 0) {
      listeners.delete(boardId);
    }
  };
}

export interface BoardChangeRefreshOptions {
  /** Which changes call for a refresh. */
  isRelevant: (change: BoardChange) => boolean;
  /** Quiet time after the last relevant change before `refresh` runs. */
  delayMs: number;
  /**
   * Longest time a refresh may be postponed by a steady stream of changes (default: twice
   * `delayMs`).
   */
  maxWaitMs?: number;
  refresh: () => void;
}

/**
 * Runs `refresh` once after a burst of relevant changes of `boardId` (trailing debounce, capped
 * by `maxWaitMs`). Pending refreshes are cancelled when the board changes or the component
 * unmounts. The latest `isRelevant` and `refresh` are used without resubscribing.
 */
export function useBoardChangeRefresh(
  boardId: string,
  { isRelevant, delayMs, maxWaitMs = delayMs * 2, refresh }: BoardChangeRefreshOptions,
): void {
  const callbacks = useRef({ isRelevant, refresh });
  useEffect(() => {
    callbacks.current = { isRelevant, refresh };
  }, [isRelevant, refresh]);

  useEffect(() => {
    if (boardId === '') {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** When the first change of the pending burst arrived. */
    let burstStartedAt: number | null = null;

    const fire = () => {
      timer = undefined;
      burstStartedAt = null;
      callbacks.current.refresh();
    };

    const unsubscribe = subscribeBoardChanges(boardId, (change) => {
      if (!callbacks.current.isRelevant(change)) {
        return;
      }
      const now = Date.now();
      burstStartedAt ??= now;
      clearTimeout(timer);
      const remaining = Math.max(0, burstStartedAt + maxWaitMs - now);
      timer = setTimeout(fire, Math.min(delayMs, remaining));
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [boardId, delayMs, maxWaitMs]);
}
