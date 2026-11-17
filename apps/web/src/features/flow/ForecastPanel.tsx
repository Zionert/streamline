import { FORECAST_MAX_REMAINING, type ForecastResponse } from '@streamline/shared';
import { Hourglass } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { ForecastRequest } from './analyticsApi';
import { formatDateRange, formatFullDate, pluralize } from './flowFormat';
import {
  REMAINING_MESSAGE,
  checkRemaining,
  checkTargetDate,
  targetDateBounds,
} from './forecastInput';
import { SegmentedToggle } from './SegmentedToggle';
import { useForecast, type ForecastState } from './useForecast';

type ForecastMode = ForecastRequest['mode'];

const MODE_OPTIONS: readonly { value: ForecastMode; label: string }[] = [
  { value: 'count', label: 'When will N cards be done?' },
  { value: 'date', label: 'How many by a date?' },
];

export const INSUFFICIENT_DATA_MESSAGE =
  'Not enough history to forecast. Forecasts use daily throughput from the last 30 days — complete a few cards first.';
export const HORIZON_EXCEEDED_MESSAGE = 'At the current pace this would take more than 2 years.';

/** Confidence levels shown, the 85% one being the recommended commitment. */
const LEVELS = [
  { key: 'p50', label: '50%', recommended: false },
  { key: 'p85', label: '85%', recommended: true },
  { key: 'p95', label: '95%', recommended: false },
] as const;

const WHEN_DESCRIPTIONS = {
  p50: 'Half of the simulations finished by this date',
  p85: '85% of simulations finished by this date',
  p95: '95% of simulations finished by this date',
} as const;

const HOW_MANY_DESCRIPTIONS = {
  p50: 'Half of the simulations completed at least this many',
  p85: '85% of simulations completed at least this many',
  p95: '95% of simulations completed at least this many',
} as const;

interface ForecastPanelProps {
  boardId: string;
  timeZone: string;
}

/**
 * Monte Carlo forecast: "when will N cards be done?" (run as soon as the panel opens, for all
 * open cards by default) or "how many cards by a date?".
 */
export function ForecastPanel({ boardId, timeZone }: ForecastPanelProps) {
  const { state, run, reset } = useForecast(boardId, timeZone);
  const [mode, setMode] = useState<ForecastMode>('count');
  const [remaining, setRemaining] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const bounds = useMemo(() => targetDateBounds(timeZone), [timeZone]);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    run({ mode: 'count' });
  }, [run]);

  const changeMode = (next: ForecastMode) => {
    if (next === mode) {
      return;
    }
    setMode(next);
    setInputError(null);
    reset();
  };

  /** The request for the current input, or `null` (with the error shown) when it is invalid. */
  const requestFromInput = (): ForecastRequest | null => {
    if (mode === 'count') {
      // Text the browser cannot read as a number (e.g. "1e") reaches React as an empty value,
      // which would otherwise mean "all open cards".
      if (input.current?.validity.badInput) {
        setInputError(REMAINING_MESSAGE);
        return null;
      }
      const check = checkRemaining(remaining);
      if (check.ok) {
        return check.value === undefined
          ? { mode: 'count' }
          : { mode: 'count', remaining: check.value };
      }
      setInputError(check.message);
      return null;
    }
    const check = checkTargetDate(targetDate, bounds);
    if (check.ok) {
      return { mode: 'date', targetDate: check.value };
    }
    setInputError(check.message);
    return null;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = requestFromInput();
    if (request === null) {
      input.current?.focus();
      return;
    }
    setInputError(null);
    run(request);
  };

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div>
        <h2 id={titleId} className="text-sm font-semibold">
          Forecast
        </h2>
        <p className="text-xs text-subtle">10,000 simulations based on recent throughput</p>
      </div>
      <SegmentedToggle
        label="Forecast question"
        options={MODE_OPTIONS}
        value={mode}
        onChange={changeMode}
        // The two questions are long: stacked at full width below 640 px, side by side above.
        className="flex flex-col self-stretch sm:inline-flex sm:flex-row sm:self-start"
      />
      <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1.5">
          <Label htmlFor={inputId} className="font-mono text-xs font-normal text-muted">
            {mode === 'count' ? 'Cards to finish' : 'Target date'}
          </Label>
          {mode === 'count' ? (
            <Input
              key="remaining"
              ref={input}
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={FORECAST_MAX_REMAINING}
              step={1}
              placeholder="All open cards"
              value={remaining}
              aria-invalid={inputError !== null}
              aria-describedby={inputError === null ? undefined : errorId}
              className="tabular-nums"
              onChange={(event) => setRemaining(event.target.value)}
            />
          ) : (
            <Input
              key="target-date"
              ref={input}
              id={inputId}
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={targetDate}
              aria-invalid={inputError !== null}
              aria-describedby={inputError === null ? undefined : errorId}
              className="tabular-nums"
              onChange={(event) => setTargetDate(event.target.value)}
            />
          )}
        </div>
        <Button type="submit" variant="secondary">
          Run forecast
        </Button>
        {inputError !== null && (
          <p id={errorId} className="basis-full text-xs text-destructive">
            {inputError}
          </p>
        )}
      </form>
      <ForecastResult state={state} mode={mode} onRetry={run} />
    </section>
  );
}

function ForecastResult({
  state,
  mode,
  onRetry,
}: {
  state: ForecastState;
  mode: ForecastMode;
  onRetry: (request: ForecastRequest) => void;
}) {
  switch (state.status) {
    case 'idle':
      return (
        <p className="text-xs text-subtle">
          {mode === 'count'
            ? 'Run the forecast to see when the cards will be done.'
            : 'Choose a date and run the forecast.'}
        </p>
      );
    case 'loading':
      return (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Running the forecast...</span>
          {LEVELS.map(({ key }) => (
            <Skeleton key={key} data-testid="forecast-row-skeleton" className="h-9 w-full" />
          ))}
        </div>
      );
    case 'error':
      return (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
          Could not run the forecast. {state.message}
          <Button variant="outline" size="sm" onClick={() => onRetry(state.request)}>
            Retry
          </Button>
        </div>
      );
    case 'ready':
      return <ForecastOutcome data={state.data} />;
  }
}

function ForecastOutcome({ data }: { data: ForecastResponse }) {
  if (data.status === 'insufficient_data') {
    return (
      <p className="flex items-start gap-2 text-sm text-subtle">
        <Hourglass
          aria-hidden="true"
          strokeWidth={2}
          className="mt-0.5 size-4 shrink-0 text-muted"
        />
        {INSUFFICIENT_DATA_MESSAGE}
      </p>
    );
  }
  const sampleNote = (
    <p className="text-xs text-subtle tabular-nums">
      Based on throughput from {formatDateRange(data.sample.from, data.sample.to)} (
      {pluralize(data.sample.totalCompleted, 'card')}).
    </p>
  );
  if (data.status === 'horizon_exceeded') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">{HORIZON_EXCEEDED_MESSAGE}</p>
        {sampleNote}
      </div>
    );
  }
  if (data.mode === 'count' && data.remaining === 0) {
    return (
      <p className="text-sm text-subtle">
        There are no open cards to forecast. Enter a number of cards instead.
      </p>
    );
  }

  const rows = LEVELS.map(({ key, label, recommended }) => ({
    key,
    label,
    recommended,
    value:
      data.mode === 'count'
        ? formatFullDate(data.percentiles[key].date)
        : `at least ${pluralize(data.percentiles[key], 'card')}`,
    description: data.mode === 'count' ? WHEN_DESCRIPTIONS[key] : HOW_MANY_DESCRIPTIONS[key],
  }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-subtle tabular-nums">
        {data.mode === 'count'
          ? `When ${pluralize(data.remaining, 'card')} will be done:`
          : `Cards done by ${formatFullDate(data.targetDate)}:`}
      </p>
      <ul aria-label="Forecast results" className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.key}
            data-recommended={row.recommended || undefined}
            className={cn(
              'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-l-2 py-1 pl-3',
              row.recommended ? 'border-ring' : 'border-transparent',
            )}
          >
            <Badge>{row.label}</Badge>
            <span className="text-lg font-semibold tabular-nums">{row.value}</span>
            <span className="basis-full text-xs text-subtle sm:basis-auto">
              {row.description}
              {row.recommended && <span className="sr-only"> (recommended commitment)</span>}
            </span>
          </li>
        ))}
      </ul>
      {sampleNote}
    </div>
  );
}
