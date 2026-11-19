import { aiStatusResponseSchema } from '@streamline/shared';
import { create } from 'zustand';

import { api } from '@/lib/api';

/**
 * Whether the AI assistant is available on the server (`GET /ai/status`), checked once per
 * session. Until the answer arrives, and when the check fails, the assistant counts as disabled,
 * so the interface looks exactly as without it.
 */
export interface AiStatusState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  enabled: boolean;
  model: string | null;
  /** Session (`sessionEpoch` of the auth store) the answer belongs to. */
  epoch: number | null;
  /** Checks the status for the session `epoch` unless it is already known or being checked. */
  load: (epoch: number) => Promise<void>;
}

const initialState: Pick<AiStatusState, 'status' | 'enabled' | 'model' | 'epoch'> = {
  status: 'idle',
  enabled: false,
  model: null,
  epoch: null,
};

export const useAiStatusStore = create<AiStatusState>()((set, get) => ({
  ...initialState,

  load: async (epoch) => {
    if (get().epoch === epoch && get().status !== 'idle') {
      return;
    }
    set({ ...initialState, status: 'loading', epoch });
    try {
      const response = await api.get<unknown>('/ai/status');
      const { enabled, model } = aiStatusResponseSchema.parse(response.data);
      if (get().epoch === epoch) {
        set({ status: 'ready', enabled, model });
      }
    } catch {
      if (get().epoch === epoch) {
        set({ status: 'error', enabled: false, model: null });
      }
    }
  },
}));

/** Forgets the cached status; intended for tests. */
export function resetAiStatusStore(): void {
  useAiStatusStore.setState(initialState);
}
