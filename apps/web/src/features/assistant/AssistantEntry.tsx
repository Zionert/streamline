import { Sparkles } from 'lucide-react';
import { lazy, Suspense, useState, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentBoard } from '@/features/boards/useCurrentBoard';
import { cn } from '@/lib/utils';
import { useAssistantPanelStore } from '@/stores/assistantPanel';

import { ASSISTANT_PANEL_CLASS } from './panelLayout';
import { useAiStatus } from './useAiStatus';

// The panel, the project dialog and the Markdown renderer load on first use, outside the main
// bundle; only these entry points and the status check are part of it.
const AssistantPanel = lazy(() => import('./AssistantPanel'));
const ProjectAssistantDialog = lazy(() => import('./ProjectAssistantDialog'));

const HEADER_BUTTON_CLASS =
  'inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-subtle transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

/**
 * "Assistant" in the top bar of a board page (Board and Flow): toggles the assistant panel.
 * Rendered only when the assistant is enabled; below 768 px only its icon is shown.
 */
export function AssistantButton({ buttonRef }: { buttonRef: RefObject<HTMLButtonElement | null> }) {
  const board = useCurrentBoard();
  const { enabled } = useAiStatus();
  const isOpen = useAssistantPanelStore((state) => state.isOpen);
  const toggle = useAssistantPanelStore((state) => state.toggle);
  if (!board || !enabled) {
    return null;
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Assistant"
      aria-pressed={isOpen}
      className={cn(HEADER_BUTTON_CLASS, isOpen && 'bg-surface-hover text-foreground')}
      onClick={toggle}
    >
      <Sparkles aria-hidden="true" className="size-4" strokeWidth={2} />
      <span aria-hidden="true" className="hidden md:inline">
        Assistant
      </span>
    </button>
  );
}

function PanelFallback() {
  return (
    <aside aria-label="Assistant" aria-busy="true" className={ASSISTANT_PANEL_CLASS}>
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="ml-auto h-9 w-3/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </aside>
  );
}

/**
 * Place of the assistant panel next to the page area: shown on board pages while it is open and
 * the assistant is enabled. It stays mounted between the Board and Flow pages of one board and
 * starts over (with that board's conversation) when another board is opened.
 */
export function AssistantPanelSlot({
  returnFocusRef,
}: {
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const board = useCurrentBoard();
  const { enabled, model } = useAiStatus();
  const isOpen = useAssistantPanelStore((state) => state.isOpen);
  const close = useAssistantPanelStore((state) => state.close);
  if (!board || !enabled || !isOpen) {
    return null;
  }
  const handleClose = () => {
    close();
    returnFocusRef.current?.focus();
  };
  return (
    <Suspense fallback={<PanelFallback />}>
      <AssistantPanel key={board.id} board={board} model={model} onClose={handleClose} />
    </Suspense>
  );
}

/** "New project with assistant" on the board list (only when the assistant is enabled). */
export function ProjectAssistantButton() {
  const { enabled } = useAiStatus();
  const [isOpen, setIsOpen] = useState(false);
  if (!enabled) {
    return null;
  }
  return (
    <>
      <Button variant="secondary" aria-haspopup="dialog" onClick={() => setIsOpen(true)}>
        <Sparkles strokeWidth={2} />
        New project with assistant
      </Button>
      {isOpen && (
        <Suspense fallback={null}>
          <ProjectAssistantDialog onClose={() => setIsOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
