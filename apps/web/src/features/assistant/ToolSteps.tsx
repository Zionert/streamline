import { Check, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { ToolStep } from './assistantText';

/** Saved steps above this count start collapsed to one "N steps" line. */
const COLLAPSE_ABOVE = 3;

interface ToolStepsProps {
  steps: readonly ToolStep[];
  /** Collapse a long list (saved steps); live steps are always listed. */
  collapsible?: boolean;
}

function StepIcon({ state }: { state: ToolStep['state'] }) {
  if (state === 'running') {
    return (
      <Loader2
        aria-hidden="true"
        className="size-3 animate-spin text-subtle motion-reduce:animate-none"
        strokeWidth={2}
      />
    );
  }
  if (state === 'ok') {
    return <Check aria-hidden="true" className="size-3 text-cat-done" strokeWidth={2.5} />;
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-3 justify-center font-semibold text-warning-text"
    >
      !
    </span>
  );
}

const STATE_TEXT: Record<ToolStep['state'], string> = {
  running: 'in progress',
  ok: 'done',
  failed: 'failed',
};

/** The tools the assistant used for an answer, as monospace rows with their state. */
export function ToolSteps({ steps, collapsible = false }: ToolStepsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (steps.length === 0) {
    return null;
  }
  const isCollapsed = collapsible && steps.length > COLLAPSE_ABOVE && !isExpanded;
  if (isCollapsed) {
    return (
      <button
        type="button"
        aria-expanded={false}
        className="flex items-center gap-1.5 rounded-sm font-mono text-xs text-subtle outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsExpanded(true)}
      >
        <ChevronRight aria-hidden="true" className="size-3" strokeWidth={2} />
        {steps.length} steps
      </button>
    );
  }
  return (
    <ul aria-label="Steps" className="flex flex-col gap-1">
      {steps.map((step) => (
        <li key={step.id} className="flex items-center gap-2 font-mono text-xs text-subtle">
          <StepIcon state={step.state} />
          <span>{step.label}</span>
          <span className="sr-only">, {STATE_TEXT[step.state]}</span>
        </li>
      ))}
    </ul>
  );
}
