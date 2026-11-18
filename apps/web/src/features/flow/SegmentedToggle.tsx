import { cn } from '@/lib/utils';

interface SegmentedToggleProps<T extends string> {
  /** Name of the group for assistive technology. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A row of toggle buttons (`aria-pressed`) of which exactly one is active. */
export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex flex-wrap gap-0.5 rounded-md border border-border p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-7 rounded-sm px-2.5 py-1 text-xs text-subtle transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-surface-hover text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
