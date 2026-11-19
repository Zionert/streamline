import { useEffect } from 'react';

import { useAiStatusStore } from '@/stores/aiStatus';
import { useAuthStore } from '@/stores/auth';

export interface AiStatus {
  /** The assistant can be used: show its elements. `false` while unknown or on an error. */
  enabled: boolean;
  /** Model the assistant uses (shown in the panel header). */
  model: string | null;
}

/**
 * Availability of the AI assistant for the logged-in user, fetched once per session (a new login
 * checks again). Every assistant element is hidden unless this says `enabled`.
 */
export function useAiStatus(): AiStatus {
  const authStatus = useAuthStore((state) => state.status);
  const epoch = useAuthStore((state) => state.sessionEpoch);
  const status = useAiStatusStore((state) => state.status);
  const enabled = useAiStatusStore((state) => state.enabled);
  const model = useAiStatusStore((state) => state.model);
  const statusEpoch = useAiStatusStore((state) => state.epoch);
  const load = useAiStatusStore((state) => state.load);
  const isAuthenticated = authStatus === 'authenticated';

  useEffect(() => {
    if (isAuthenticated) {
      void load(epoch);
    }
  }, [isAuthenticated, epoch, load]);

  const isCurrent = isAuthenticated && statusEpoch === epoch && status === 'ready';
  return { enabled: isCurrent && enabled, model: isCurrent ? model : null };
}
