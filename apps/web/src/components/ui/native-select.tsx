import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Styled native `<select>` (the shadcn/ui "native select" variant). Used instead of a custom
 * listbox for short option lists: keyboard and screen reader support come from the browser.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 py-1 text-base text-foreground transition-[color,border-color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary-subtle',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-danger-subtle',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
