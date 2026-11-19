import type { AiChatToolEvent, AiMessage } from '@streamline/shared';

import { toolStepLabel, type ToolStep, type TurnFailure } from './assistantText';

/** The turn being answered: the question (not saved yet), tool steps and the streamed text. */
export interface LiveTurn {
  question: string;
  steps: ToolStep[];
  text: string;
}

export interface ChatState {
  /**
   * `loading` — the conversation is being opened; `ready`; `unavailable` — it is gone or the
   * board is no longer accessible (404); `error` — opening it failed otherwise (`loadError`).
   */
  load: 'loading' | 'ready' | 'unavailable' | 'error';
  loadError: string | null;
  conversationId: string | null;
  /** Saved messages, oldest first. */
  messages: AiMessage[];
  /** Loads older messages; `null` at the beginning of the conversation. */
  nextCursor: string | null;
  isLoadingEarlier: boolean;
  turn: LiveTurn | null;
  /** The last turn failed after its stream had started (shown in place of the answer). */
  failure: TurnFailure | null;
  /** The last turn was stopped by the user ("Stopped."). */
  stopped: boolean;
  /** The daily limit is used up: the input stays disabled until the page is reloaded. */
  limitReached: boolean;
  /** Text of the input. */
  draft: string;
  /** Text of the latest finished answer, announced to screen readers. */
  announcement: string;
}

export type ChatAction =
  | { type: 'loadStarted' }
  | {
      type: 'loaded';
      conversationId: string;
      messages: AiMessage[];
      nextCursor: string | null;
    }
  | { type: 'loadFailed'; message: string }
  | { type: 'unavailable' }
  | { type: 'earlierStarted' }
  | { type: 'earlierLoaded'; messages: AiMessage[]; nextCursor: string | null }
  | { type: 'earlierFailed' }
  | { type: 'draftChanged'; draft: string }
  | { type: 'turnStarted'; question: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; event: AiChatToolEvent }
  | { type: 'done'; messages: AiMessage[] }
  | { type: 'turnFailed'; failure: TurnFailure }
  /** The turn did not start (e.g. 409 or no network): its question goes back to the input. */
  | { type: 'turnRejected' }
  | { type: 'turnStopped' }
  | { type: 'limitReached' }
  | { type: 'cleared' };

export const initialChatState: ChatState = {
  load: 'loading',
  loadError: null,
  conversationId: null,
  messages: [],
  nextCursor: null,
  isLoadingEarlier: false,
  turn: null,
  failure: null,
  stopped: false,
  limitReached: false,
  draft: '',
  announcement: '',
};

/** The question of the current turn back in the input (unless the user typed something new). */
function withQuestionRestored(state: ChatState): ChatState {
  const question = state.turn?.question ?? '';
  return { ...state, turn: null, draft: state.draft.trim() === '' ? question : state.draft };
}

function lastAnswer(messages: readonly AiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'ASSISTANT') {
      return message.content;
    }
  }
  return '';
}

function withToolEvent(steps: ToolStep[], event: AiChatToolEvent): ToolStep[] {
  if (event.status === 'started') {
    if (steps.some((step) => step.id === event.id)) {
      return steps;
    }
    return [...steps, { id: event.id, label: toolStepLabel(event.name), state: 'running' }];
  }
  const state = event.ok === false ? 'failed' : 'ok';
  if (!steps.some((step) => step.id === event.id)) {
    return [...steps, { id: event.id, label: toolStepLabel(event.name), state }];
  }
  return steps.map((step) => (step.id === event.id ? { ...step, state } : step));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, load: 'loading', loadError: null };
    case 'loaded':
      return {
        ...state,
        load: 'ready',
        loadError: null,
        conversationId: action.conversationId,
        messages: action.messages,
        nextCursor: action.nextCursor,
      };
    case 'loadFailed':
      return { ...state, load: 'error', loadError: action.message };
    case 'unavailable':
      return { ...state, load: 'unavailable', turn: null, failure: null };
    case 'earlierStarted':
      return { ...state, isLoadingEarlier: true };
    case 'earlierLoaded': {
      const known = new Set(state.messages.map((message) => message.id));
      return {
        ...state,
        isLoadingEarlier: false,
        messages: [
          ...action.messages.filter((message) => !known.has(message.id)),
          ...state.messages,
        ],
        nextCursor: action.nextCursor,
      };
    }
    case 'earlierFailed':
      return { ...state, isLoadingEarlier: false };
    case 'draftChanged':
      return { ...state, draft: action.draft };
    case 'turnStarted':
      return {
        ...state,
        turn: { question: action.question, steps: [], text: '' },
        failure: null,
        stopped: false,
        draft: '',
      };
    case 'delta':
      return state.turn
        ? { ...state, turn: { ...state.turn, text: state.turn.text + action.text } }
        : state;
    case 'tool':
      return state.turn
        ? {
            ...state,
            turn: { ...state.turn, steps: withToolEvent(state.turn.steps, action.event) },
          }
        : state;
    case 'done':
      // The saved rows replace the optimistic question and the streamed text.
      return {
        ...state,
        turn: null,
        messages: [...state.messages, ...action.messages],
        announcement: lastAnswer(action.messages),
      };
    case 'turnFailed':
      // Without "Try again" the question goes back to the input instead.
      return action.failure.canRetry
        ? { ...state, turn: null, failure: action.failure }
        : { ...withQuestionRestored(state), failure: action.failure };
    case 'turnRejected':
      return withQuestionRestored(state);
    case 'turnStopped':
      return { ...withQuestionRestored(state), stopped: true };
    case 'limitReached':
      return { ...withQuestionRestored(state), limitReached: true };
    case 'cleared':
      return {
        ...state,
        messages: [],
        nextCursor: null,
        isLoadingEarlier: false,
        failure: null,
        stopped: false,
        announcement: '',
      };
  }
}
