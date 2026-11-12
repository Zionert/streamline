import { useState } from 'react';

import { NARROW_SCREEN_QUERY, matchesMediaQuery } from '@/hooks/useMediaQuery';

export const SIDEBAR_STORAGE_KEY = 'streamline-sidebar-collapsed';

/** The stored collapsed flag, or `null` when the user has never toggled the sidebar. */
export function readSidebarCollapsed(): boolean | null {
  try {
    const value = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return value === 'true' ? true : value === 'false' ? false : null;
  } catch {
    return null;
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    // The state still applies until the page is reloaded.
  }
}

/** Collapsed by default on screens narrower than 1024 px, unless the user chose otherwise. */
export function initialSidebarCollapsed(): boolean {
  return readSidebarCollapsed() ?? matchesMediaQuery(NARROW_SCREEN_QUERY);
}

export interface SidebarState {
  /** Docked sidebar (768 px and wider): collapsed to zero width. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Drawer (below 768 px): open over the page. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

/**
 * Collapsed state of the docked sidebar (persisted) and open state of the mobile drawer.
 * Leaving the mobile layout closes the drawer, so it never reopens by itself on a later resize.
 */
export function useSidebarState(isMobile: boolean): SidebarState {
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wasMobile, setWasMobile] = useState(isMobile);

  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (!isMobile) {
      setDrawerOpen(false);
    }
  }

  const toggleCollapsed = () => {
    const next = !collapsed;
    storeSidebarCollapsed(next);
    setCollapsed(next);
  };

  return { collapsed, toggleCollapsed, drawerOpen, setDrawerOpen };
}
