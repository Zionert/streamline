import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-foreground transition-[color,border-color,box-shadow] outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary-subtle',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-danger-subtle',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
