import { cn } from '@/lib/utils';

/** StreamLine mark: a rhombus with an arrow pointing right, drawn in the primary colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn('size-6 text-primary', className)}
    >
      <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="currentColor" />
      <path
        d="M7.5 12h8M12.5 8.5 16 12l-3.5 3.5"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The mark followed by the product name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-semibold text-foreground">StreamLine</span>
    </span>
  );
}
