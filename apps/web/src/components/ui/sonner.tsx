import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useThemeStore } from '@/stores/theme';

/** Toast container styled with the design tokens and following the current colour theme. */
function Toaster(props: ToasterProps) {
  const theme = useThemeStore((state) => state.resolvedTheme);

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--surface-raised)',
          '--normal-text': 'var(--text)',
          '--normal-border': 'var(--border-strong)',
          '--border-radius': '8px',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
