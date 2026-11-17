import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/** Pill: monospace 12 px with a 4 px radius and a strong border. */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-px font-mono text-xs font-normal whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default: 'border-border-strong text-subtle',
        secondary: 'border-border-strong bg-surface-hover text-subtle',
        destructive: 'border-transparent bg-danger text-primary-foreground',
        outline: 'border-border-strong text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
