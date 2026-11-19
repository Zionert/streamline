import {
  AI_ERROR_CODES,
  sendAiMessageSchema,
  type AiChatEvent,
  type AiConversation,
} from '@streamline/shared';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getApiErrorInfo } from '@/lib/api-error';

import {
  AssistantRequestError,
  clearBoardConversation,
  createProjectSession,
  getBoardConversation,
  getConversationMessages,
  streamAssistantTurn,
} from './assistantApi';
import {
  isAssistantLimitReached,
  markAssistantLimitReached,
  useAssistantLimitReached,
} from './assistantLimit';
import {
  interruptedTurnFailure,
  NETWORK_ERROR_MESSAGE,
  TURN_IN_PROGRESS_MESSAGE,
  turnFailureFor,
  UNKNOWN_ERROR_MESSAGE,
} from './assistantText';
import { chatReducer, initialChatState, type ChatAction, type ChatState } from './chatState';

/** The conversation of a board's assistant panel, or a new "New project with assistant" session. */
export type ChatSource = { kind: 'board'; boardId: string } | { kind: 'project' };

export interface AssistantChat {
  state: ChatState;
  /** Whether a turn is being answered (the send button is "Stop"). */
  isAnswering: boolean;
  setDraft: (draft: string) => void;
  /** Sends a question (ignored while answering, after the limit, or when empty / too long). */
  send: (question: string) => void;
  /** Stops the answer being streamed; nothing of the turn is saved. */
  stop: () => void;
  /** Sends the question of the failed turn again. */
  retry: () => void;
  loadEarlier: () => void;
  /** Opens the conversation again after a failed load. */
  reload: () => void;
  /** Clears the board conversation; rejects (for the confirmation dialog) when it fails. */
  clear: () => Promise<void>;
}

/** Whether the question can be sent: valid for the API (not blank, within the length limit). */
export function isSendable(question: string): boolean {
  return sendAiMessageSchema.safeParse({ content: question }).success;
}

const LOAD_ERROR_MESSAGE = 'Could not open the conversation.';

function loadFailure(error: unknown): ChatAction {
  const { status } = getApiErrorInfo(error);
  return status === 404
    ? { type: 'unavailable' }
    : { type: 'loadFailed', message: LOAD_ERROR_MESSAGE };
}

/**
 * State and actions of one assistant conversation: opening it (history of a board chat, or a new
 * project session), streaming turns with tool steps, stopping, errors and the daily limit. The
 * answer being streamed is dropped when the component using it unmounts.
 */
export function useAssistantChat(source: ChatSource): AssistantChat {
  const [chatState, dispatch] = useReducer(chatReducer, initialChatState);
  // The daily limit outlives this chat: it holds until the page is reloaded.
  const limitReached = useAssistantLimitReached();
  const state: ChatState =
    limitReached && !chatState.limitReached ? { ...chatState, limitReached } : chatState;
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const controllerRef = useRef<AbortController | null>(null);
  // Changes when the history is replaced (cleared), so older pages still loading are dropped.
  const historyGenerationRef = useRef(0);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // One project session per mounted chat, also when effects run twice (StrictMode).
  const sessionRef = useRef<Promise<AiConversation> | null>(null);
  const boardId = source.kind === 'board' ? source.boardId : null;

  useEffect(() => {
    let active = true;
    const open = async () => {
      if (boardId !== null) {
        const page = await getBoardConversation(boardId);
        return {
          conversationId: page.conversation.id,
          messages: page.messages,
          nextCursor: page.nextCursor,
        };
      }
      sessionRef.current ??= createProjectSession();
      const conversation = await sessionRef.current;
      return { conversationId: conversation.id, messages: [], nextCursor: null };
    };
    open().then(
      (loaded) => {
        if (active) {
          dispatch({ type: 'loaded', ...loaded });
        }
      },
      (error: unknown) => {
        sessionRef.current = null;
        if (active) {
          dispatch(loadFailure(error));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [boardId, loadAttempt]);

  // An answer still streaming is abandoned with the chat (the server saves nothing then).
  useEffect(
    () => () => {
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.abort();
    },
    [],
  );

  const setDraft = useCallback((draft: string) => dispatch({ type: 'draftChanged', draft }), []);

  const send = useCallback((raw: string) => {
    const question = raw.trim();
    const current = stateRef.current;
    if (
      !isSendable(question) ||
      controllerRef.current ||
      current.limitReached ||
      isAssistantLimitReached() ||
      current.load !== 'ready' ||
      !current.conversationId
    ) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => controllerRef.current === controller;
    dispatch({ type: 'turnStarted', question });

    const onEvent = (event: AiChatEvent) => {
      if (!isCurrent()) {
        return;
      }
      switch (event.event) {
        case 'delta':
          dispatch({ type: 'delta', text: event.data.text });
          break;
        case 'tool':
          dispatch({ type: 'tool', event: event.data });
          break;
        case 'done':
          dispatch({ type: 'done', messages: event.data.messages });
          break;
        case 'error':
          if (event.data.code === AI_ERROR_CODES.CONVERSATION_NOT_FOUND) {
            dispatch({ type: 'unavailable' });
            break;
          }
          if (event.data.code === AI_ERROR_CODES.AI_CONVERSATION_CLEARED) {
            historyGenerationRef.current += 1;
            dispatch({ type: 'cleared' });
          }
          dispatch({
            type: 'turnFailed',
            failure: turnFailureFor(question, event.data.code, event.data.message),
          });
          break;
      }
    };

    streamAssistantTurn(current.conversationId, question, { signal: controller.signal, onEvent })
      .then((end) => {
        if (isCurrent() && end === 'incomplete') {
          dispatch({ type: 'turnFailed', failure: interruptedTurnFailure(question) });
        }
      })
      .catch((error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        if (controller.signal.aborted) {
          dispatch({ type: 'turnStopped' });
          return;
        }
        if (!(error instanceof AssistantRequestError)) {
          // The connection dropped while the answer was streaming.
          dispatch({ type: 'turnFailed', failure: interruptedTurnFailure(question) });
          return;
        }
        if (error.status === 429) {
          markAssistantLimitReached();
          dispatch({ type: 'limitReached' });
        } else if (error.status === 404) {
          dispatch({ type: 'unavailable' });
        } else {
          dispatch({ type: 'turnRejected' });
          if (error.status === 409) {
            toast.error(TURN_IN_PROGRESS_MESSAGE);
          } else if (error.status === undefined) {
            toast.error(NETWORK_ERROR_MESSAGE);
          } else if (error.status === 400 && error.code !== undefined) {
            toast.error(error.message);
          } else if (error.status !== 401) {
            // 401: the session has ended and the app returns to the login page.
            toast.error(UNKNOWN_ERROR_MESSAGE);
          }
        }
      })
      .finally(() => {
        if (isCurrent()) {
          controllerRef.current = null;
        }
      });
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    const failure = stateRef.current.failure;
    if (failure?.canRetry) {
      send(failure.question);
    }
  }, [send]);

  const loadEarlier = useCallback(() => {
    const { conversationId, nextCursor, isLoadingEarlier } = stateRef.current;
    if (!conversationId || !nextCursor || isLoadingEarlier) {
      return;
    }
    dispatch({ type: 'earlierStarted' });
    const generation = historyGenerationRef.current;
    const isCurrent = () => generation === historyGenerationRef.current;
    getConversationMessages(conversationId, nextCursor).then(
      (page) => {
        if (isCurrent()) {
          dispatch({ type: 'earlierLoaded', ...page });
        }
      },
      (error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        if (getApiErrorInfo(error).status === 404) {
          dispatch({ type: 'unavailable' });
          return;
        }
        dispatch({ type: 'earlierFailed' });
        toast.error('Could not load earlier messages.');
      },
    );
  }, []);

  const reload = useCallback(() => {
    dispatch({ type: 'loadStarted' });
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const clear = useCallback(async () => {
    if (boardId === null) {
      return;
    }
    await clearBoardConversation(boardId);
    historyGenerationRef.current += 1;
    dispatch({ type: 'cleared' });
  }, [boardId]);

  return {
    state,
    isAnswering: state.turn !== null,
    setDraft,
    send,
    stop,
    retry,
    loadEarlier,
    reload,
    clear,
  };
}
