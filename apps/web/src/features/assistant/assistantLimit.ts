import { create } from 'zustand';

import { useAuthStore } from '@/stores/auth';

/**
 * The daily assistant limit was reached (429 `AI_LIMIT_REACHED`). Kept for the rest of the page
 * load, in every conversation (closing and reopening the panel, another board, the project
 * dialog), but only for the session it was reached in (a new login starts afresh).
 */
interface AssistantLimitState {
  /** `sessionEpoch` of the auth store when the limit was reached; `null` when not reached. */
  reachedInEpoch: number | null;
}

const useAssistantLimitStore = create<AssistantLimitState>()(() => ({ reachedInEpoch: null }));

export function markAssistantLimitReached(): void {
  useAssistantLimitStore.setState({ reachedInEpoch: useAuthStore.getState().sessionEpoch });
}

/** Whether the limit was reached in the current session (read outside React). */
export function isAssistantLimitReached(): boolean {
  return useAssistantLimitStore.getState().reachedInEpoch === useAuthStore.getState().sessionEpoch;
}

/** Whether the limit was reached in the current session. */
export function useAssistantLimitReached(): boolean {
  const reachedInEpoch = useAssistantLimitStore((state) => state.reachedInEpoch);
  const epoch = useAuthStore((state) => state.sessionEpoch);
  return reachedInEpoch === epoch;
}

/** Forgets the limit; intended for tests (a page reload does the same in the app). */
export function resetAssistantLimit(): void {
  useAssistantLimitStore.setState({ reachedInEpoch: null });
}
