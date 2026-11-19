import { AI_USER_MESSAGE_MAX_LENGTH, type AiMessage } from '@streamline/shared';
import { ArrowDown, ArrowUp, Sparkles, Square } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { AssistantMarkdown, type MarkdownBoard } from './AssistantMarkdown';
import {
  chatEntries,
  CONVERSATION_UNAVAILABLE_MESSAGE,
  LIMIT_REACHED_MESSAGE,
  messageTime,
  type ChatEntry,
} from './assistantText';
import type { LiveTurn } from './chatState';
import { ToolSteps } from './ToolSteps';
import { isSendable, type AssistantChat as ChatControls } from './useAssistantChat';

/** The character counter appears from this length of the input. */
const COUNTER_FROM = 3500;

/** Distance from the bottom (px) within which the list keeps following new text. */
const STICK_THRESHOLD = 24;

export interface ChatEmptyState {
  title: string;
  /** Optional line under the title. */
  description?: string;
}

interface AssistantChatProps {
  chat: ChatControls;
  /** Board whose card keys become links in answers (`null` in a project session). */
  board: MarkdownBoard | null;
  placeholder: string;
  emptyState: ChatEmptyState;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * The conversation with the assistant: saved messages with their tool steps, the answer being
 * streamed, errors and the input. Used by the board panel and by the project dialog.
 */
export function AssistantChat({
  chat,
  board,
  placeholder,
  emptyState,
  inputRef,
}: AssistantChatProps) {
  const { state } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const earlierAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const [isAwayFromLatest, setIsAwayFromLatest] = useState(false);
  const entries = useMemo(() => chatEntries(state.messages), [state.messages]);

  // Follow new text while the user stays at the bottom; keep the view when older messages load.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const anchor = earlierAnchorRef.current;
    if (anchor && !state.isLoadingEarlier) {
      earlierAnchorRef.current = null;
      list.scrollTop = anchor.top + (list.scrollHeight - anchor.height);
      return;
    }
    if (stickRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries, state.turn, state.failure, state.stopped, state.isLoadingEarlier, state.load]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_THRESHOLD;
    stickRef.current = atBottom;
    setIsAwayFromLatest(!atBottom);
  };

  const scrollToLatest = () => {
    const list = listRef.current;
    stickRef.current = true;
    setIsAwayFromLatest(false);
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  };

  const loadEarlier = () => {
    const list = listRef.current;
    if (list) {
      earlierAnchorRef.current = { height: list.scrollHeight, top: list.scrollTop };
    }
    chat.loadEarlier();
  };

  const isEmpty =
    state.load === 'ready' &&
    entries.length === 0 &&
    !state.turn &&
    !state.failure &&
    !state.stopped &&
    !state.limitReached;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        {state.load === 'unavailable' ? (
          <p role="alert" className="m-4 text-sm text-subtle">
            {CONVERSATION_UNAVAILABLE_MESSAGE}
          </p>
        ) : (
          <div
            ref={listRef}
            role="log"
            // Answers are announced once finished (below), not fragment by fragment.
            aria-live="off"
            aria-label="Conversation"
            aria-busy={state.load === 'loading' || chat.isAnswering}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
            onScroll={handleScroll}
          >
            {state.load === 'loading' && <HistorySkeleton />}
            {state.load === 'error' && (
              <div
                role="alert"
                className="flex flex-col items-start gap-2 text-sm text-destructive"
              >
                {state.loadError}
                <Button variant="subtle" size="sm" onClick={chat.reload}>
                  Retry
                </Button>
              </div>
            )}
            {state.load === 'ready' && state.nextCursor && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                disabled={state.isLoadingEarlier}
                onClick={loadEarlier}
              >
                {state.isLoadingEarlier ? 'Loading…' : 'Load earlier messages'}
              </Button>
            )}
            {isEmpty && <EmptyConversation emptyState={emptyState} />}
            {entries.map((entry) => (
              <ChatEntryView key={entryKey(entry)} entry={entry} board={board} />
            ))}
            {state.turn && <LiveTurnView turn={state.turn} board={board} />}
            {state.failure && (
              <>
                {state.failure.canRetry && <UserBubble content={state.failure.question} />}
                <NoticeBlock tone="danger">
                  <p>{state.failure.message}</p>
                  {state.failure.canRetry && (
                    <Button variant="subtle" size="sm" className="self-start" onClick={chat.retry}>
                      Try again
                    </Button>
                  )}
                </NoticeBlock>
              </>
            )}
            {state.stopped && <p className="font-mono text-xs text-muted">Stopped.</p>}
            {state.limitReached && (
              <NoticeBlock tone="warning">
                <p>{LIMIT_REACHED_MESSAGE}</p>
              </NoticeBlock>
            )}
          </div>
        )}
        {isAwayFromLatest && state.load === 'ready' && (
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Scroll to latest"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-raised"
            onClick={scrollToLatest}
          >
            <ArrowDown strokeWidth={2} />
          </Button>
        )}
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {state.announcement}
      </div>
      <ChatInput
        chat={chat}
        placeholder={placeholder}
        inputRef={inputRef}
        disabled={state.load === 'unavailable' || state.limitReached}
        canSend={state.load === 'ready'}
        onSend={() => {
          stickRef.current = true;
        }}
      />
    </div>
  );
}

function entryKey(entry: ChatEntry): string {
  return entry.kind === 'user' ? entry.message.id : entry.id;
}

function HistorySkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading conversation...</span>
      <Skeleton className="ml-auto h-9 w-3/5" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function EmptyConversation({ emptyState }: { emptyState: ChatEmptyState }) {
  return (
    <div className="my-auto flex flex-col items-center gap-3 py-6 text-center">
      <Sparkles aria-hidden="true" className="size-6 text-muted" strokeWidth={2} />
      <p className="text-[15px] font-semibold">{emptyState.title}</p>
      {emptyState.description && (
        <p className="max-w-80 text-sm text-subtle">{emptyState.description}</p>
      )}
    </div>
  );
}

function UserBubble({ content, message }: { content: string; message?: AiMessage }) {
  return (
    <div
      className="max-w-[85%] self-end rounded-lg bg-surface-hover px-3 py-2 text-sm whitespace-pre-wrap break-words"
      title={message ? messageTime(message.createdAt) : undefined}
    >
      <span className="sr-only">You: </span>
      {content}
    </div>
  );
}

function ChatEntryView({ entry, board }: { entry: ChatEntry; board: MarkdownBoard | null }) {
  if (entry.kind === 'user') {
    return <UserBubble content={entry.message.content} message={entry.message} />;
  }
  return (
    <div
      className="flex flex-col gap-2"
      title={entry.message ? messageTime(entry.message.createdAt) : undefined}
    >
      <ToolSteps steps={entry.steps} collapsible />
      {entry.message && entry.message.content !== '' && (
        <AssistantMarkdown content={entry.message.content} board={board} />
      )}
    </div>
  );
}

function LiveTurnView({ turn, board }: { turn: LiveTurn; board: MarkdownBoard | null }) {
  return (
    <>
      <UserBubble content={turn.question} />
      <div className="flex flex-col gap-2">
        <ToolSteps steps={turn.steps} />
        <div className="flex flex-col">
          {turn.text !== '' && <AssistantMarkdown content={turn.text} board={board} />}
          <span
            aria-hidden="true"
            data-testid="stream-cursor"
            className="animate-pulse text-sm leading-[1.55] text-subtle motion-reduce:animate-none"
          >
            ▍
          </span>
        </div>
      </div>
    </>
  );
}

function NoticeBlock({ tone, children }: { tone: 'danger' | 'warning'; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-2 rounded-r-md border-l-2 px-3 py-2 text-sm text-foreground',
        tone === 'danger'
          ? 'border-danger bg-danger-subtle'
          : 'border-warning-text bg-surface-hover',
      )}
    >
      {children}
    </div>
  );
}

interface ChatInputProps {
  chat: ChatControls;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** The input is disabled (daily limit used up, conversation gone). */
  disabled: boolean;
  /** The conversation is open, so questions can be sent (typing is possible before). */
  canSend: boolean;
  onSend: () => void;
}

function ChatInput({ chat, placeholder, inputRef, disabled, canSend, onSend }: ChatInputProps) {
  const { draft } = chat.state;
  const counterId = useId();
  const showCounter = draft.length >= COUNTER_FROM;
  const isTooLong = draft.trim().length > AI_USER_MESSAGE_MAX_LENGTH;

  // Grows with the text from one up to six lines (the CSS maximum), then scrolls.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.style.height = 'auto';
    if (input.scrollHeight > 0) {
      input.style.height = `${String(input.scrollHeight + 2)}px`;
    }
  }, [draft, inputRef]);

  const canSubmit = !disabled && canSend && isSendable(draft);

  const submit = () => {
    if (chat.isAnswering || !canSubmit) {
      return;
    }
    onSend();
    chat.send(draft);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (chat.isAnswering) {
      chat.stop();
      return;
    }
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      aria-label="Ask the assistant"
      className="flex flex-col gap-2 border-t border-border p-3"
      onSubmit={handleSubmit}
    >
      <div className="relative">
        <textarea
          ref={inputRef}
          rows={1}
          aria-label="Message"
          aria-describedby={showCounter ? counterId : undefined}
          aria-invalid={isTooLong ? true : undefined}
          placeholder={placeholder}
          value={draft}
          disabled={disabled}
          className="block max-h-[138px] min-h-9 w-full resize-none overflow-y-auto rounded-md border border-border-strong bg-surface py-2 pr-12 pl-3 text-sm leading-5 text-foreground outline-none placeholder:text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary-subtle disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => chat.setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {/* One button for both actions, so the keyboard focus stays on it when it switches.
            Unavailable is `aria-disabled` rather than `disabled`, which would drop the focus. */}
        <Button
          type="submit"
          variant={chat.isAnswering ? 'subtle' : 'default'}
          size="icon-xs"
          aria-label={chat.isAnswering ? 'Stop' : 'Send'}
          aria-disabled={chat.isAnswering ? undefined : !canSubmit}
          className={cn(
            'absolute right-2 bottom-1.5 size-7',
            !chat.isAnswering && !canSubmit && 'cursor-not-allowed opacity-50',
          )}
        >
          {chat.isAnswering ? (
            <Square className="size-3.5 fill-current" strokeWidth={2} />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2} />
          )}
        </Button>
      </div>
      {showCounter && (
        <div className="flex justify-end font-mono text-[11px] text-muted">
          <span id={counterId} className={cn(isTooLong && 'text-destructive')}>
            {draft.length} / {AI_USER_MESSAGE_MAX_LENGTH}
          </span>
        </div>
      )}
    </form>
  );
}
