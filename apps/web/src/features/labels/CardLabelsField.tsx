import {
  createLabelSchema,
  LABEL_COLORS,
  type Card,
  type Label,
  type LabelColor,
} from '@streamline/shared';
import { Check, ChevronLeft, Pencil, Plus, Tag } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label as FieldLabel } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmDialog } from '@/features/boards/ConfirmDialog';
import { getCardErrorMessage } from '@/features/cards/cardErrorMessage';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';

import { LabelPill } from './LabelPill';
import { LABEL_COLOR_NAMES, labelColorStyle } from './labelColors';
import { labelsOfCard } from './labelOrder';

/** Toast id of a failed label toggle (a newer failure replaces the message). */
const TOGGLE_ERROR_TOAST_ID = 'card-label-error';

type PickerView = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; label: Label };

interface CardLabelsFieldProps {
  card: Card;
  /** `card:write`: attach and remove labels, create, edit and delete board labels. */
  canWrite: boolean;
  /** Id of the element labelling the field (the "Labels" term of the details). */
  labelledBy: string;
}

/**
 * The labels of a card as pills. With `card:write` a picker attaches and removes labels
 * (optimistically) and manages the board's labels: create, rename / recolour and delete.
 */
export function CardLabelsField({ card, canWrite, labelledBy }: CardLabelsFieldProps) {
  const labels = useBoardStore((state) => state.labels);
  const deleteLabel = useBoardStore((state) => state.deleteLabel);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const cardLabels = labelsOfCard(card, labelsById);

  return (
    <div className="flex flex-col gap-2">
      {cardLabels.length > 0 ? (
        <ul aria-labelledby={labelledBy} className="flex flex-wrap gap-1">
          {cardLabels.map((label) => (
            <li key={label.id} className="max-w-full">
              <LabelPill name={label.name} color={label.color} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-subtle">No labels</p>
      )}
      {canWrite && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button ref={trigger} variant="outline" size="sm" className="self-start">
              <Tag strokeWidth={2} />
              Edit labels
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <LabelPicker
              card={card}
              labels={labels}
              onDelete={(label) => {
                setOpen(false);
                setDeleting(label);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      {canWrite && (
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(next) => {
            if (!next) {
              setDeleting(null);
            }
          }}
          title={`Delete label "${deleting?.name ?? ''}"?`}
          description="The label will be deleted from the board and removed from all cards."
          confirmLabel="Delete label"
          onConfirm={async () => {
            if (deleting) {
              await deleteLabel(deleting.id);
            }
          }}
          returnFocusRef={trigger}
        />
      )}
    </div>
  );
}

interface LabelPickerProps {
  card: Card;
  labels: readonly Label[];
  onDelete: (label: Label) => void;
}

/** Content of the label popover: the board's labels with checkboxes, or a label form. */
function LabelPicker({ card, labels, onDelete }: LabelPickerProps) {
  const labelsStatus = useBoardStore((state) => state.labelsStatus);
  const reloadLabels = useBoardStore((state) => state.reloadLabels);
  const toggleCardLabel = useBoardStore((state) => state.toggleCardLabel);
  const [view, setView] = useState<PickerView>({ kind: 'list' });
  const [search, setSearch] = useState('');

  if (view.kind !== 'list') {
    return (
      <LabelForm
        label={view.kind === 'edit' ? view.label : null}
        onDone={() => setView({ kind: 'list' })}
        onDelete={onDelete}
      />
    );
  }

  const query = search.trim().toLocaleLowerCase('en-GB');
  const shown =
    query === ''
      ? labels
      : labels.filter((label) => label.name.toLocaleLowerCase('en-GB').includes(query));

  const toggle = (label: Label, attach: boolean) => {
    toggleCardLabel(card.id, label.id, attach).catch((error: unknown) => {
      toast.error(getCardErrorMessage(error), { id: TOGGLE_ERROR_TOAST_ID });
    });
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-center font-mono text-[11px] tracking-[0.06em] text-muted uppercase">
        Labels
      </p>
      {labels.length > 0 && (
        <Input
          type="search"
          aria-label="Search labels"
          placeholder="Search labels"
          value={search}
          className="h-8"
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {labelsStatus === 'error' && labels.length === 0 ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-destructive">
          Could not load the labels.
          <Button variant="outline" size="sm" onClick={() => void reloadLabels()}>
            Retry
          </Button>
        </div>
      ) : labelsStatus === 'loading' && labels.length === 0 ? (
        <p role="status" className="text-sm text-subtle">
          Loading labels...
        </p>
      ) : labels.length === 0 ? (
        <p className="text-sm text-subtle">This board has no labels yet.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-subtle">No labels match.</p>
      ) : (
        <ul aria-label="Board labels" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {shown.map((label) => {
            const checked = card.labelIds.includes(label.id);
            const checkboxId = `card-label-${label.id}`;
            return (
              <li key={label.id} className="flex items-center gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={checked}
                  aria-label={label.name}
                  onCheckedChange={(next) => toggle(label, next === true)}
                />
                <label htmlFor={checkboxId} className="flex min-w-0 flex-1 cursor-pointer">
                  <LabelPill name={label.name} color={label.color} className="w-full" />
                </label>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Edit label ${label.name}`}
                  className="text-subtle"
                  onClick={() => setView({ kind: 'edit', label })}
                >
                  <Pencil strokeWidth={2} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="justify-start"
        onClick={() => setView({ kind: 'create' })}
      >
        <Plus strokeWidth={2} />
        Create a label
      </Button>
    </div>
  );
}

/** The colour an arrow key (or Home / End) moves to in the palette, `null` for other keys. */
function paletteKeyTarget(key: string, current: LabelColor): LabelColor | null {
  const index = LABEL_COLORS.indexOf(current);
  const last = LABEL_COLORS.length - 1;
  let target: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      target = index === last ? 0 : index + 1;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      target = index === 0 ? last : index - 1;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = last;
      break;
    default:
      return null;
  }
  return LABEL_COLORS[target] ?? null;
}

interface LabelFormProps {
  /** The label being edited, `null` to create one. */
  label: Label | null;
  onDone: () => void;
  onDelete: (label: Label) => void;
}

/** Creates a label or changes the name and colour of one (only the changed fields are sent). */
function LabelForm({ label, onDone, onDelete }: LabelFormProps) {
  const createLabel = useBoardStore((state) => state.createLabel);
  const updateLabel = useBoardStore((state) => state.updateLabel);
  const [name, setName] = useState(label?.name ?? '');
  const [color, setColor] = useState<LabelColor>(label?.color ?? 'GREEN');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameId = useId();
  const errorId = useId();
  const paletteId = useId();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = createLabelSchema.safeParse({ name, color });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid label');
      return;
    }
    const input = parsed.data;
    setIsSubmitting(true);
    setError(null);
    try {
      if (label === null) {
        await createLabel(input);
      } else {
        const changes = {
          ...(input.name === label.name ? {} : { name: input.name }),
          ...(input.color === label.color ? {} : { color: input.color }),
        };
        if (changes.name !== undefined || changes.color !== undefined) {
          await updateLabel(label.id, changes);
        }
      }
      onDone();
    } catch (submitError) {
      setIsSubmitting(false);
      setError(getCardErrorMessage(submitError));
    }
  };

  return (
    <form
      noValidate
      aria-label={label === null ? 'Create a label' : `Edit label ${label.name}`}
      className="flex flex-col gap-3 p-3"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Back to labels"
          onClick={onDone}
        >
          <ChevronLeft strokeWidth={2} />
        </Button>
        <p className="flex-1 pr-6 text-center font-mono text-[11px] tracking-[0.06em] text-muted uppercase">
          {label === null ? 'Create a label' : 'Edit label'}
        </p>
      </div>
      <div className="flex justify-center rounded-md bg-surface-hover p-3">
        <LabelPill name={name.trim() || 'Label'} color={color} />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={nameId} className="text-xs font-semibold text-subtle">
          Name
        </FieldLabel>
        <Input
          id={nameId}
          autoFocus
          value={name}
          className="h-8"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p id={paletteId} className="text-xs font-semibold text-subtle">
          Colour
        </p>
        <div
          role="radiogroup"
          aria-labelledby={paletteId}
          className="grid grid-cols-5 gap-1.5"
          onKeyDown={(event) => {
            const next = paletteKeyTarget(event.key, color);
            if (next === null) {
              return;
            }
            event.preventDefault();
            setColor(next);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-label-color="${next}"]`)
              ?.focus();
          }}
        >
          {LABEL_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === color}
              aria-label={LABEL_COLOR_NAMES[option]}
              title={LABEL_COLOR_NAMES[option]}
              data-label-color={option}
              // Roving tabindex: Tab reaches the selected colour, arrow keys change it.
              tabIndex={option === color ? 0 : -1}
              className={cn(
                'flex h-7 items-center justify-center rounded-sm border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
                option === color && 'ring-2 ring-ring',
              )}
              style={labelColorStyle(option)}
              onClick={() => setColor(option)}
            >
              {option === color && (
                <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
              )}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {label === null ? 'Create' : 'Save'}
        </Button>
        {label !== null && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => onDelete(label)}
          >
            Delete label
          </Button>
        )}
      </div>
    </form>
  );
}
