/** Colour theme chosen by the user; `system` follows the operating system setting. */
export type ThemePreference = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** localStorage key; the inline script in index.html reads the same key before React starts. */
export const THEME_STORAGE_KEY = 'streamline-theme';

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

const DEFAULT_PREFERENCE: ThemePreference = 'light';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The stored preference, or the default when nothing valid is stored or storage is blocked. */
export function readStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** Persists the preference; storage errors (private mode, quota) are ignored. */
export function storeTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The choice still applies for this page load.
  }
}

function darkSchemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_SCHEME_QUERY) : null;
}

export function systemPrefersDark(): boolean {
  return darkSchemeQuery()?.matches ?? false;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return preference;
}

/** Sets or removes the `dark` class on `<html>`. */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Calls `listener` whenever the operating system switches between light and dark.
 * Returns the unsubscribe function.
 */
export function onSystemThemeChange(listener: (prefersDark: boolean) => void): () => void {
  const query = darkSchemeQuery();
  if (!query) {
    return () => {};
  }
  const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
  query.addEventListener('change', handleChange);
  return () => query.removeEventListener('change', handleChange);
}
