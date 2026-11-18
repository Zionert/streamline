import type { AiConfig } from '../config/env.js';
import type { LlmProvider } from './llm-provider.js';
import {
  OpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from './openai-compatible-provider.js';

export type LlmProviderConfig = Pick<
  AiConfig,
  | 'AI_ENABLED'
  | 'LLM_BASE_URL'
  | 'LLM_MODEL'
  | 'LLM_API_KEY'
  | 'LLM_TIMEOUT_MS'
  | 'LLM_IDLE_TIMEOUT_MS'
>;

export type CreateLlmProviderOptions = Pick<
  OpenAICompatibleProviderOptions,
  'fetch' | 'onDiagnostic'
>;

/**
 * Builds the assistant's model provider from the configuration, or returns `null` when the
 * assistant is disabled (the rest of the application works without it).
 */
export function createLlmProvider(
  config: LlmProviderConfig,
  options: CreateLlmProviderOptions = {},
): LlmProvider | null {
  if (!config.AI_ENABLED) return null;
  // Guaranteed by the configuration schema; checked again for callers building config by hand.
  if (!config.LLM_BASE_URL || !config.LLM_MODEL) {
    throw new Error('LLM_BASE_URL and LLM_MODEL are required when AI_ENABLED=true');
  }
  return new OpenAICompatibleProvider({
    baseUrl: config.LLM_BASE_URL,
    model: config.LLM_MODEL,
    apiKey: config.LLM_API_KEY,
    timeoutMs: config.LLM_TIMEOUT_MS,
    idleTimeoutMs: config.LLM_IDLE_TIMEOUT_MS,
    ...options,
  });
}
