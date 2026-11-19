import { useRef } from 'react';
import { Outlet } from 'react-router';

import { AssistantPanelSlot } from '@/features/assistant/AssistantEntry';

import { AppHeader } from './AppHeader';

/**
 * Shell of the authenticated part of the app: the top bar above a full-height page area, with the
 * assistant panel (when open on a board page) docked on its right.
 */
export function AppLayout() {
  const assistantButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex h-svh flex-col bg-background">
      <AppHeader assistantButtonRef={assistantButtonRef} />
      <div className="relative flex min-h-0 flex-1">
        <Outlet />
        <AssistantPanelSlot returnFocusRef={assistantButtonRef} />
      </div>
    </div>
  );
}
