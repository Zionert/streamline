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
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '4px',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
