import { getBoardErrorMessage } from '@/features/boards/boardErrorMessage';
import { getApiErrorInfo } from '@/lib/api-error';

const INVALID_PARAMETERS = 'The request was not valid. Check the values and try again.';

/** The message of the first validation issue (`{ message }`), if the details carry one. */
function firstIssueMessage(details: unknown): string | undefined {
  if (!Array.isArray(details)) {
    return undefined;
  }
  const first: unknown = details[0];
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return typeof first.message === 'string' ? first.message : undefined;
  }
  return undefined;
}

/** User-facing message for a failed analytics or forecast request. */
export function getFlowErrorMessage(error: unknown): string {
  const { status, code, details } = getApiErrorInfo(error);
  if (status === 400 && code === 'VALIDATION_ERROR') {
    return firstIssueMessage(details) ?? INVALID_PARAMETERS;
  }
  return getBoardErrorMessage(error);
}
