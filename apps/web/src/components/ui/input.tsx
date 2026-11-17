import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 py-1 text-base text-foreground transition-[color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary-subtle',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-danger-subtle',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
