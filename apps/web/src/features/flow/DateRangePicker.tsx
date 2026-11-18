import { CalendarRange, Check } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type Ref } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import {
  RANGE_PRESETS,
  hasRangeErrors,
  isSameSelection,
  rangeLabel,
  validateCustomRange,
  type CustomRangeErrors,
  type DateRange,
  type FlowRangeSelection,
} from './flowRange';

interface DateRangePickerProps {
  selection: FlowRangeSelection;
  /** The dates of the selection (prefill the custom range). */
  range: DateRange;
  /** Today in the browser's time zone: the latest day a range may end on. */
  today: string;
  /** The popover opens (a chance to read "today" again). */
  onOpen?: () => void;
  onSelect: (selection: FlowRangeSelection) => void;
}

/**
 * The range of the Flow page: a button showing it, opening a popover with the presets (applied
 * at once) and a custom range of two native date inputs, validated on "Apply".
 */
export function DateRangePicker({
  selection,
  range,
  today,
  onOpen,
  onSelect,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const label = rangeLabel(selection);

  const choose = (next: FlowRangeSelection) => {
    setOpen(false);
    onSelect(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          onOpen?.();
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="subtle" size="sm" aria-label={`Date range: ${label}`}>
          <CalendarRange strokeWidth={2} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <ul aria-label="Date range presets" className="flex flex-col gap-0.5">
          {RANGE_PRESETS.map((preset) => {
            const option: FlowRangeSelection = { kind: 'preset', preset: preset.value };
            const active = isSameSelection(option, selection);
            return (
              <li key={preset.value}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-subtle transition-colors outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                    active && 'text-foreground',
                  )}
                >
                  {preset.label}
                  {active && <Check aria-hidden="true" className="size-4" strokeWidth={2} />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border pt-3">
          {/* Unmounted while the popover is closed: every opening starts from the range in use. */}
          <CustomRangeForm
            initial={range}
            today={today}
            onApply={(from, to) => choose({ kind: 'custom', from, to })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CustomRangeFormProps {
  initial: DateRange;
  today: string;
  onApply: (from: string, to: string) => void;
}

function CustomRangeForm({ initial, today, onApply }: CustomRangeFormProps) {
  const titleId = useId();
  const fromId = useId();
  const toId = useId();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [errors, setErrors] = useState<CustomRangeErrors>({});
  const fromInput = useRef<HTMLInputElement>(null);
  const toInput = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateCustomRange(from, to, today);
    setErrors(found);
    if (!hasRangeErrors(found)) {
      onApply(from, to);
      return;
    }
    // The first invalid field takes the focus, so its error is announced at once.
    (found.from === undefined ? toInput : fromInput).current?.focus();
  };

  return (
    <form noValidate aria-labelledby={titleId} className="flex flex-col gap-3" onSubmit={submit}>
      <h2 id={titleId} className="font-mono text-[11px] text-muted uppercase">
        Custom range
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <DateField
          id={fromId}
          inputRef={fromInput}
          label="From"
          value={from}
          max={today}
          error={errors.from}
          onChange={setFrom}
        />
        <DateField
          id={toId}
          inputRef={toInput}
          label="To"
          value={to}
          max={today}
          error={errors.to}
          onChange={setTo}
        />
      </div>
      <Button type="submit" variant="secondary" size="sm" className="self-end">
        Apply
      </Button>
    </form>
  );
}

interface DateFieldProps {
  id: string;
  inputRef: Ref<HTMLInputElement>;
  label: string;
  value: string;
  max: string;
  error: string | undefined;
  onChange: (value: string) => void;
}

function DateField({ id, inputRef, label, value, max, error, onChange }: DateFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-subtle">
        {label}
      </label>
      <Input
        ref={inputRef}
        id={id}
        type="date"
        value={value}
        max={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="px-2 font-mono text-xs md:text-xs"
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
