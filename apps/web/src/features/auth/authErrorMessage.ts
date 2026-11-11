import { isAxiosError } from 'axios';

import { getApiErrorInfo } from '@/lib/api-error';

const NETWORK_ERROR = 'Unable to reach the server. Please try again.';
const RATE_LIMITED = 'Too many attempts. Please try again later.';
const UNKNOWN_ERROR = 'Something went wrong. Please try again.';

/** User-facing message for a failed login or registration request. */
export function getAuthErrorMessage(error: unknown): string {
  if (isAxiosError(error) && !error.response) {
    return NETWORK_ERROR;
  }
  const { status, message } = getApiErrorInfo(error);
  if (status === 429) {
    return RATE_LIMITED;
  }
  // 400 (validation), 401 (invalid credentials) and 409 (email taken) carry a message meant
  // for the user.
  if ((status === 400 || status === 401 || status === 409) && message) {
    return message;
  }
  return UNKNOWN_ERROR;
}
