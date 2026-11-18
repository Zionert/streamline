import { AppError } from '../errors/app-error.js';
import type { LlmUsage } from './llm-provider.js';

export type LlmErrorCode =
  'LLM_UNAVAILABLE' | 'LLM_TIMEOUT' | 'LLM_HTTP_ERROR' | 'LLM_BAD_RESPONSE' | 'LLM_ABORTED';

/**
 * HTTP status used when the error reaches a client. An aborted call means the client went away,
 * so its (non-standard, "client closed request") status is never actually delivered.
 */
const LLM_ERROR_STATUS: Record<LlmErrorCode, number> = {
  LLM_UNAVAILABLE: 503,
  LLM_TIMEOUT: 504,
  LLM_HTTP_ERROR: 502,
  LLM_BAD_RESPONSE: 502,
  LLM_ABORTED: 499,
};

export interface LlmErrorOptions {
  /** HTTP status returned by the provider (`LLM_HTTP_ERROR` only). */
  providerStatus?: number;
  /**
   * The provider's own error text, with credentials removed and truncated. For logs only: it is
   * not part of `message` or `details`, which may be shown to users.
   */
  providerMessage?: string;
  cause?: unknown;
}

/** A failed call to the model provider. The message never contains the API key. */
export class LlmError extends AppError {
  public readonly providerStatus: number | undefined;
  public readonly providerMessage: string | undefined;
  /**
   * Tokens already spent on the request this call belongs to (e.g. the first attempt of a
   * validated call), still to be counted against the limits; `null` when unknown.
   */
  public usage: LlmUsage | null = null;

  constructor(
    public override readonly code: LlmErrorCode,
    message: string,
    options: LlmErrorOptions = {},
  ) {
    super(LLM_ERROR_STATUS[code], code, message);
    this.providerStatus = options.providerStatus;
    this.providerMessage = options.providerMessage;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface AiValidationIssue {
  /** Dotted path of the invalid value (`cards[0].title`), empty for the whole output. */
  path: string;
  message: string;
}

export const AI_INVALID_OUTPUT_MESSAGE =
  'The assistant returned an invalid response twice. Please try again or rephrase your request.';

/**
 * The model's output stayed invalid after the one allowed correction. `issues` (for logs and
 * tests) describe the last attempt and `usage` the tokens spent on all attempts (still counted
 * against the limits); the message is safe to show to users.
 */
export class AiValidationError extends AppError {
  constructor(
    public readonly issues: AiValidationIssue[],
    public readonly usage: LlmUsage | null = null,
    message = AI_INVALID_OUTPUT_MESSAGE,
  ) {
    super(502, 'AI_INVALID_OUTPUT', message);
  }
}
