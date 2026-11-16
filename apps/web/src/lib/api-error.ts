import { errorResponseSchema } from '@streamline/shared';
import { isAxiosError } from 'axios';

export interface ApiErrorInfo {
  /** HTTP status, absent when no response was received (network error). */
  status?: number;
  code?: string;
  message?: string;
  /** Extra data of the error (e.g. the full column of `WIP_LIMIT_EXCEEDED`), not validated. */
  details?: unknown;
}

/** Extracts the status and the `{ error: { code, message } }` body of a failed API call. */
export function getApiErrorInfo(error: unknown): ApiErrorInfo {
  if (!isAxiosError(error) || !error.response) {
    return {};
  }
  const parsed = errorResponseSchema.safeParse(error.response.data);
  return {
    status: error.response.status,
    ...(parsed.success
      ? {
          code: parsed.data.error.code,
          message: parsed.data.error.message,
          ...(parsed.data.error.details === undefined
            ? {}
            : { details: parsed.data.error.details }),
        }
      : {}),
  };
}
