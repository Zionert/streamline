import type { Board } from '@streamline/shared';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/features/boards/ConfirmDialog';
import { useAssistantPanelStore } from '@/stores/assistantPanel';

import { AssistantChat } from './AssistantChat';
import { ASSISTANT_PANEL_CLASS } from './panelLayout';
import { useAssistantChat } from './useAssistantChat';

const EMPTY_STATE = {
  title: 'Ask about this board',
};

export interface AssistantPanelProps {
  board: Board;
  /** Model name shown in the header. */
  model: string | null;
  /** Closes the panel (and gives the focus back to the "Assistant" button). */
  onClose: () => void;
}

/**
 * The assistant panel docked next to a board (Board and Flow pages): the user's private
 * conversation about this board. Loaded lazily with its Markdown renderer on first open.
 */
export default function AssistantPanel({ board, model, onClose }: AssistantPanelProps) {
  const chat = useAssistantChat({ kind: 'board', boardId: board.id });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const focusRequested = useAssistantPanelStore((state) => state.focusRequested);
  const focusHandled = useAssistantPanelStore((state) => state.focusHandled);

  // Opened by the user: the input takes the focus.
  useEffect(() => {
    if (focusRequested) {
      inputRef.current?.focus();
      focusHandled();
    }
  }, [focusRequested, focusHandled]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Only for the panel itself: dialogs opened from it (portals) handle their own Escape.
    if (
      event.key !== 'Escape' ||
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
    ) {
      return;
    }
    event.preventDefault();
    onClose();
  };

  const canClear = chat.state.load === 'ready' && !chat.isAnswering;

  return (
    <aside aria-label="Assistant" className={ASSISTANT_PANEL_CLASS} onKeyDown={handleKeyDown}>
      <AssistantPanelHeader model={model}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear conversation"
          title="Clear conversation"
          disabled={!canClear}
          onClick={() => setIsConfirmingClear(true)}
        >
          <RotateCcw strokeWidth={2} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close" onClick={onClose}>
          <X strokeWidth={2} />
        </Button>
      </AssistantPanelHeader>
      <AssistantChat
        chat={chat}
        board={board}
        placeholder="Ask about this board…"
        emptyState={EMPTY_STATE}
        inputRef={inputRef}
      />
      <ConfirmDialog
        open={isConfirmingClear}
        onOpenChange={setIsConfirmingClear}
        title="Clear this conversation?"
        description="The assistant forgets it too."
        confirmLabel="Clear conversation"
        onConfirm={chat.clear}
        returnFocusRef={inputRef}
      />
    </aside>
  );
}

function AssistantPanelHeader({ model, children }: { model: string | null; children: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
      <h2 className="text-[15px] font-semibold">Assistant</h2>
      {model && (
        <Badge className="max-w-40 truncate" title={model}>
          <span className="sr-only">Model: </span>
          <span className="truncate">{model}</span>
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </div>
  );
}
