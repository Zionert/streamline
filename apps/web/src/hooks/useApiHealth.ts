import { healthResponseSchema } from '@streamline/shared';
import { useCallback, useEffect, useState } from 'react';

export type ApiHealthStatus = 'checking' | 'ok' | 'unavailable';

const HEALTH_URL = '/api/health';

async function fetchHealth(signal: AbortSignal): Promise<ApiHealthStatus> {
  try {
    const response = await fetch(HEALTH_URL, { signal });
    if (!response.ok) {
      return 'unavailable';
    }
    const parsed = healthResponseSchema.safeParse(await response.json());
    return parsed.success ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Polls `GET /health` of the API once on mount and on demand via `recheck`. */
export function useApiHealth(): { status: ApiHealthStatus; recheck: () => void } {
  const [status, setStatus] = useState<ApiHealthStatus>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });
    return () => controller.abort();
  }, [attempt]);

  const recheck = useCallback(() => {
    setStatus('checking');
    setAttempt((value) => value + 1);
  }, []);

  return { status, recheck };
}
