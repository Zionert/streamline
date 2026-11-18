import { describe, expect, it } from 'vitest';

import { loadAiConfig } from '../config/env.js';
import { createFetchStub, streamingResponse } from '../test/llm-fetch.js';
import { createLlmProvider } from './create-llm-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';

describe('createLlmProvider', () => {
  it('returns null while the assistant is disabled', () => {
    expect(createLlmProvider(loadAiConfig({}))).toBeNull();
    expect(
      createLlmProvider(loadAiConfig({ AI_ENABLED: 'false', LLM_MODEL: 'qwen3.5:9b' })),
    ).toBeNull();
  });

  it('returns an OpenAI-compatible provider for the configured URL, model and key', async () => {
    const stub = createFetchStub(() =>
      streamingResponse([new TextEncoder().encode('data: [DONE]\n\n')]),
    );
    const provider = createLlmProvider(
      loadAiConfig({
        AI_ENABLED: 'true',
        LLM_BASE_URL: 'https://api.openai.com/v1/',
        LLM_MODEL: 'gpt-4o-mini',
        LLM_API_KEY: 'sk-test',
      }),
      { fetch: stub.fetch },
    );

    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider?.model).toBe('gpt-4o-mini');
    for await (const _event of provider?.streamChat({ messages: [] }) ?? []) {
      // Drains the stream.
    }
    expect(stub.calls[0]).toMatchObject({
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { authorization: 'Bearer sk-test' },
      body: { model: 'gpt-4o-mini' },
    });
  });

  it('refuses an enabled configuration without URL or model', () => {
    expect(() =>
      createLlmProvider({
        AI_ENABLED: true,
        LLM_BASE_URL: undefined,
        LLM_MODEL: 'm',
        LLM_API_KEY: undefined,
        LLM_TIMEOUT_MS: 1,
        LLM_IDLE_TIMEOUT_MS: 1,
        LLM_REASONING_EFFORT: 'none',
      }),
    ).toThrow(/LLM_BASE_URL and LLM_MODEL are required/);
  });
});

describe('createLlmProvider: reasoning effort', () => {
  const ollama = {
    AI_ENABLED: 'true',
    LLM_BASE_URL: 'http://localhost:11434/v1',
    LLM_MODEL: 'qwen3.5:9b',
  };

  async function sentBody(env: NodeJS.ProcessEnv, reasoningEffort?: 'medium' | 'default') {
    const stub = createFetchStub(() =>
      streamingResponse([new TextEncoder().encode('data: [DONE]\n\n')]),
    );
    const provider = createLlmProvider(loadAiConfig(env), { fetch: stub.fetch });
    const request = { messages: [], ...(reasoningEffort && { reasoningEffort }) };
    for await (const _event of provider?.streamChat(request) ?? []) {
      // Drains the stream.
    }
    return stub.calls[0]?.body;
  }

  it('sends reasoning_effort "none" by default', async () => {
    expect(await sentBody(ollama)).toMatchObject({ reasoning_effort: 'none' });
  });

  it('sends the configured value, which a request can override', async () => {
    expect(await sentBody({ ...ollama, LLM_REASONING_EFFORT: 'low' })).toMatchObject({
      reasoning_effort: 'low',
    });
    expect(await sentBody({ ...ollama, LLM_REASONING_EFFORT: 'low' }, 'medium')).toMatchObject({
      reasoning_effort: 'medium',
    });
  });

  it('omits the field for "default", in the configuration or in a request', async () => {
    expect(await sentBody({ ...ollama, LLM_REASONING_EFFORT: 'default' })).not.toHaveProperty(
      'reasoning_effort',
    );
    expect(await sentBody({ ...ollama, LLM_REASONING_EFFORT: '' })).not.toHaveProperty(
      'reasoning_effort',
    );
    expect(await sentBody(ollama, 'default')).not.toHaveProperty('reasoning_effort');
  });

  it('lets a request choose an effort when the configuration omits it', async () => {
    expect(await sentBody({ ...ollama, LLM_REASONING_EFFORT: 'default' }, 'medium')).toMatchObject({
      reasoning_effort: 'medium',
    });
  });
});
