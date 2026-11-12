import { create } from 'zustand';

import {
  applyTheme,
  onSystemThemeChange,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

export interface ThemeState {
  preference: ThemePreference;
  /** The theme actually shown (`system` resolved through `prefers-color-scheme`). */
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

function initialThemeState(): Pick<ThemeState, 'preference' | 'resolvedTheme'> {
  const preference = readStoredTheme();
  return { preference, resolvedTheme: resolveTheme(preference, systemPrefersDark()) };
}

export const useThemeStore = create<ThemeState>()((set) => ({
  ...initialThemeState(),

  setPreference: (preference) => {
    storeTheme(preference);
    const resolvedTheme = resolveTheme(preference, systemPrefersDark());
    applyTheme(resolvedTheme);
    set({ preference, resolvedTheme });
  },
}));

/**
 * Applies the stored theme and keeps following the operating system while the preference is
 * `system`. Returns the function that stops following it.
 */
export function initTheme(): () => void {
  const state = initialThemeState();
  useThemeStore.setState(state);
  applyTheme(state.resolvedTheme);
  return onSystemThemeChange((prefersDark) => {
    const { preference } = useThemeStore.getState();
    if (preference !== 'system') {
      return;
    }
    const resolvedTheme = resolveTheme(preference, prefersDark);
    applyTheme(resolvedTheme);
    useThemeStore.setState({ resolvedTheme });
  });
}

/** Restores the default (light) theme state without touching storage; used by tests. */
export function resetThemeStore(): void {
  useThemeStore.setState({ preference: 'light', resolvedTheme: 'light' });
}
