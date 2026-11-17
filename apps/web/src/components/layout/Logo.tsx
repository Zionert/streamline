import { cn } from '@/lib/utils';

/**
 * StreamLine mark: three vertical bars of decreasing height (a stream thinning out), in the
 * accent, text and muted text colours.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-testid="logo-mark"
      className={cn('size-4 shrink-0', className)}
    >
      <rect x="1" y="1" width="3" height="14" rx="1" className="fill-primary" />
      <rect x="6.5" y="4" width="3" height="11" rx="1" className="fill-text" />
      <rect x="12" y="7" width="3" height="8" rx="1" className="fill-muted" />
    </svg>
  );
}

/** The mark followed by the product name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold text-foreground">StreamLine</span>
    </span>
  );
}
