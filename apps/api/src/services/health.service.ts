import type { HealthResponse } from '@streamline/shared';

export const healthService = {
  /** Liveness check; intentionally does not touch the database. */
  getStatus(): HealthResponse {
    return { status: 'ok' };
  },
};
