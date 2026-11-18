import { LlmError } from './ai-errors.js';
import type {
  LlmEvent,
  LlmMessage,
  LlmProvider,
  LlmReasoningEffort,
  LlmRequest,
  LlmToolDefinition,
} from './llm-provider.js';

/**
 * One scripted response: waits `delayMs` (abortable), yields `events`, then throws `error` if set.
 * `done` is not added automatically, so scenarios can also simulate broken streams.
 */
export interface MockLlmScenario {
  events?: LlmEvent[];
  error?: Error;
  delayMs?: number;
}

/** What the mock received (a copy; the abort signal itself is left out). */
export interface MockLlmRecordedRequest {
  messages: LlmMessage[];
  tools: LlmToolDefinition[] | undefined;
  temperature: number | undefined;
  reasoningEffort: LlmReasoningEffort | undefined;
  hasSignal: boolean;
}

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError('LLM_ABORTED', 'The AI request was cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmError('LLM_ABORTED', 'The AI request was cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Model provider for tests: answers each call with the next queued scenario and records the
 * requests it received. No network access.
 */
export class MockLlmProvider implements LlmProvider {
  readonly requests: MockLlmRecordedRequest[] = [];
  private readonly scenarios: MockLlmScenario[];

  constructor(
    scenarios: MockLlmScenario[] = [],
    readonly model = 'mock-model',
  ) {
    this.scenarios = [...scenarios];
  }

  /** A plain text answer (optionally split into several deltas). */
  static text(...parts: string[]): MockLlmScenario {
    return {
      events: [
        ...parts.map((text): LlmEvent => ({ type: 'text-delta', text })),
        { type: 'done', finishReason: 'stop' },
      ],
    };
  }

  /** A single tool call; `args` is serialized unless it already is a string (to script bad JSON). */
  static toolCall(name: string, args: unknown, id = 'call_1'): MockLlmScenario {
    const argumentsJson = typeof args === 'string' ? args : JSON.stringify(args);
    return {
      events: [
        { type: 'tool-call', id, name, argumentsJson },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    };
  }

  /** A call failing with the given provider error. */
  static failure(error: Error): MockLlmScenario {
    return { error };
  }

  enqueue(...scenarios: MockLlmScenario[]): this {
    this.scenarios.push(...scenarios);
    return this;
  }

  /** Scenarios not consumed yet (tests can assert that all were used). */
  get pendingScenarios(): number {
    return this.scenarios.length;
  }

  streamChat(request: LlmRequest): AsyncIterable<LlmEvent> {
    this.requests.push({
      messages: structuredClone(request.messages),
      tools: request.tools && structuredClone(request.tools),
      temperature: request.temperature,
      reasoningEffort: request.reasoningEffort,
      hasSignal: request.signal !== undefined,
    });
    const scenario = this.scenarios.shift();
    return this.play(scenario, request.signal);
  }

  private async *play(
    scenario: MockLlmScenario | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<LlmEvent, void, undefined> {
    if (!scenario) {
      throw new Error('MockLlmProvider: no scripted scenario left for this call');
    }
    if (scenario.delayMs !== undefined) await wait(scenario.delayMs, signal);
    for (const event of scenario.events ?? []) {
      if (signal?.aborted) throw new LlmError('LLM_ABORTED', 'The AI request was cancelled');
      yield event;
    }
    if (scenario.error) throw scenario.error;
  }
}
