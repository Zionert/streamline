import * as React from 'react';

import { cn } from '@/lib/utils';

/** Pulsing placeholder shown in place of content that is still loading. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-surface-hover motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
