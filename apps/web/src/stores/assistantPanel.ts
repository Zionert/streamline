import { create } from 'zustand';

/** localStorage key remembering whether the assistant panel of the board pages is open. */
export const ASSISTANT_OPEN_STORAGE_KEY = 'streamline-assistant-open';

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(ASSISTANT_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeOpen(isOpen: boolean): void {
  try {
    window.localStorage.setItem(ASSISTANT_OPEN_STORAGE_KEY, String(isOpen));
  } catch {
    // Storage blocked (private mode, quota): the panel still opens for this page load.
  }
}

export interface AssistantPanelState {
  isOpen: boolean;
  /**
   * The user has just opened the panel, so its input should take the focus once it is shown.
   * A panel restored as open on page load does not steal the focus.
   */
  focusRequested: boolean;
  toggle: () => void;
  close: () => void;
  /** Marks the focus request as handled. */
  focusHandled: () => void;
}

export const useAssistantPanelStore = create<AssistantPanelState>()((set, get) => ({
  isOpen: readStoredOpen(),
  focusRequested: false,

  toggle: () => {
    const isOpen = !get().isOpen;
    storeOpen(isOpen);
    set({ isOpen, focusRequested: isOpen });
  },
  close: () => {
    storeOpen(false);
    set({ isOpen: false, focusRequested: false });
  },
  focusHandled: () => set({ focusRequested: false }),
}));

/** Reads the panel state from storage again; intended for tests. */
export function resetAssistantPanelStore(): void {
  useAssistantPanelStore.setState({ isOpen: readStoredOpen(), focusRequested: false });
}
