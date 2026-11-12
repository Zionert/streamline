import {
  CARD_PRIORITIES,
  hasBoardPermission,
  type Card,
  type UpdateCardInput,
} from '@streamline/shared';
import { Link2, SquareCheck, Trash2, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/features/boards/ConfirmDialog';
import { cardPath } from '@/features/boards/paths';
import { cn } from '@/lib/utils';
import { useBoardStore } from '@/stores/board';

import { getCardChanges, type CardDraft } from './cardChanges';
import { getCardErrorMessage } from './cardErrorMessage';
import { cardsOf } from './cardOrder';
import { formatCalendarDate, formatDateTime } from './format';
import { PRIORITY_LABELS } from './cardLabels';
import { PriorityFlag } from './priority';

/** Toast ids: a newer message of the same kind replaces the previous one. */
const SAVE_ERROR_TOAST_ID = 'card-save-error';
const COPY_LINK_TOAST_ID = 'card-copy-link';

/**
 * Marks a text field with unsaved changes: Escape there discards the changes instead of closing
 * the dialog (a second Escape closes it).
 */
const DIRTY_FIELD_ATTRIBUTE = 'data-dirty-field';

interface CardDetailsDialogProps {
  card: Card;
  onClose: () => void;
}

/**
 * Details of a card (DESIGN: modal, two columns). Every field is saved on its own, sending only
 * the changed field; members without `card:write` see the fields read-only.
 */
export function CardDetailsDialog({ card, onClose }: CardDetailsDialogProps) {
  const board = useBoardStore((state) => state.board);
  const columns = useBoardStore((state) => state.columns);
  const members = useBoardStore((state) => state.members);
  const cardsByColumn = useBoardStore((state) => state.cardsByColumn);
  const isMovingCard = useBoardStore((state) => state.isMovingCard);
  const updateCard = useBoardStore((state) => state.updateCard);
  const moveCard = useBoardStore((state) => state.moveCard);
  const deleteCard = useBoardStore((state) => state.deleteCard);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const canWrite = board !== null && hasBoardPermission(board.role, 'card:write');
  const boardId = board?.id ?? card.boardId;
  const ids = {
    status: useId(),
    assignee: useId(),
    priority: useId(),
    dueDate: useId(),
  };

  /** Saves the changed fields of the draft; failures are toasts (the store restores the card). */
  const save = (draft: CardDraft): string | null => {
    const result = getCardChanges(card, draft);
    if (!result.ok) {
      return result.error;
    }
    if (result.changes) {
      const changes: UpdateCardInput = result.changes;
      updateCard(card.id, changes).catch((error: unknown) => {
        toast.error(getCardErrorMessage(error), { id: SAVE_ERROR_TOAST_ID });
      });
    }
    return null;
  };

  const changeColumn = (columnId: string) => {
    if (columnId !== card.columnId) {
      // Moves the card to the end of the chosen column; failures are reported by the board.
      void moveCard(card.id, columnId, cardsOf(cardsByColumn, columnId).length);
    }
  };

  const copyLink = async () => {
    const url = new URL(cardPath(boardId, card.key), window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to the clipboard.', { id: COPY_LINK_TOAST_ID });
    } catch {
      toast.error('Could not copy the link.', { id: COPY_LINK_TOAST_ID });
    }
  };

  const assigneeKnown =
    card.assigneeId === null || members.some((member) => member.userId === card.assigneeId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0 p-0 sm:max-w-[900px]"
        onEscapeKeyDown={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.hasAttribute(DIRTY_FIELD_ATTRIBUTE)
          ) {
            event.preventDefault();
          }
        }}
      >
        <DialogTitle className="sr-only">
          {card.key} {card.title}
        </DialogTitle>
        <div className="flex items-center gap-2 border-b px-6 py-3">
          <SquareCheck aria-hidden="true" className="size-4 text-primary" strokeWidth={2} />
          <span className="text-xs font-semibold text-subtle">{card.key}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
              <Link2 strokeWidth={2} />
              Copy link
            </Button>
            {canWrite && (
              <Button
                ref={deleteButton}
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setIsDeleting(true)}
              >
                <Trash2 strokeWidth={2} />
                Delete
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X strokeWidth={2} />
            </Button>
          </div>
        </div>
        <div className="grid gap-6 p-6 md:grid-cols-[65fr_35fr]">
          <div className="flex min-w-0 flex-col gap-4">
            {canWrite ? (
              <TitleField key={card.title} title={card.title} onSave={(title) => save({ title })} />
            ) : (
              <h2 className="text-xl font-semibold break-words">{card.title}</h2>
            )}
            <DescriptionField
              key={card.description ?? ''}
              description={card.description}
              readOnly={!canWrite}
              onSave={(description) => save({ description })}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4 text-sm">
            <dl className="flex flex-col gap-4">
              <Field label="Status" htmlFor={ids.status}>
                <NativeSelect
                  id={ids.status}
                  value={card.columnId}
                  disabled={!canWrite || isMovingCard}
                  onChange={(event) => changeColumn(event.target.value)}
                >
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Assignee" htmlFor={ids.assignee}>
                <NativeSelect
                  id={ids.assignee}
                  value={card.assigneeId ?? ''}
                  disabled={!canWrite}
                  onChange={(event) => save({ assigneeId: event.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                  {!assigneeKnown && card.assigneeId !== null && (
                    <option value={card.assigneeId}>Former member</option>
                  )}
                </NativeSelect>
              </Field>
              <Field label="Priority" htmlFor={ids.priority}>
                <div className="flex items-center gap-2">
                  <PriorityFlag priority={card.priority} />
                  <NativeSelect
                    id={ids.priority}
                    value={card.priority}
                    disabled={!canWrite}
                    onChange={(event) => save({ priority: event.target.value })}
                  >
                    {CARD_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </Field>
              {canWrite ? (
                <Field label="Due date" htmlFor={ids.dueDate}>
                  <DueDateField
                    key={card.dueDate ?? ''}
                    id={ids.dueDate}
                    dueDate={card.dueDate}
                    onSave={(dueDate) => save({ dueDate })}
                  />
                </Field>
              ) : (
                <Field label="Due date">
                  <p>{card.dueDate ? formatCalendarDate(card.dueDate) : 'No due date'}</p>
                </Field>
              )}
            </dl>
            <div className="flex flex-col gap-1 border-t pt-4 text-xs text-subtle">
              <p>Created {formatDateTime(card.createdAt)}</p>
              <p>Updated {formatDateTime(card.updatedAt)}</p>
            </div>
          </div>
        </div>
        {canWrite && (
          <ConfirmDialog
            open={isDeleting}
            onOpenChange={setIsDeleting}
            title={`Delete card ${card.key}?`}
            description="The card will be deleted permanently."
            confirmLabel="Delete card"
            onConfirm={async () => {
              await deleteCard(card.id);
              onClose();
            }}
            returnFocusRef={deleteButton}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A labelled detail. With `htmlFor` the term is the `<label>` of a form control; without it (a
 * read-only value) it is plain text, associated with the value by the description list.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-semibold text-subtle">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-xs font-semibold text-subtle">
            {label}
          </Label>
        ) : (
          label
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

interface DueDateFieldProps {
  id: string;
  dueDate: string | null;
  /** Returns a validation error, or `null` when the date was accepted. */
  onSave: (dueDate: string | null) => string | null;
}

/**
 * The due date. Saved on Enter or when leaving the field, not on every change: while a date is
 * typed, browsers report intermediate values (e.g. the year 0002, 0020, 0202, 2026). Escape
 * discards the change; remounted (by `key`) whenever the saved date changes.
 */
function DueDateField({ id, dueDate, onSave }: DueDateFieldProps) {
  const saved = dueDate ?? '';
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const dirty = value !== saved;

  const commit = () => {
    if (!dirty) {
      return;
    }
    setError(onSave(value === '' ? null : value));
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        id={id}
        type="date"
        value={value}
        {...{ [DIRTY_FIELD_ATTRIBUTE]: dirty ? '' : undefined }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && dirty) {
            setValue(saved);
            setError(null);
          }
        }}
        onBlur={commit}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface TitleFieldProps {
  title: string;
  /** Returns a validation error, or `null` when the title was accepted. */
  onSave: (title: string) => string | null;
}

/**
 * The title, editable in place: Enter or leaving the field saves, Escape discards the change.
 * Remounted (by `key`) whenever the saved title changes.
 */
function TitleField({ title, onSave }: TitleFieldProps) {
  const [value, setValue] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const dirty = value !== title;

  const commit = () => {
    const saveError = onSave(value);
    if (saveError) {
      setError(saveError);
      return false;
    }
    // A saved change remounts the field; a change of whitespace only is just tidied up.
    setValue(value.trim());
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (commit()) {
        event.currentTarget.blur();
      }
    } else if (event.key === 'Escape' && dirty) {
      setValue(title);
      setError(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        aria-label="Title"
        rows={1}
        value={value}
        {...{ [DIRTY_FIELD_ATTRIBUTE]: dirty ? '' : undefined }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="min-h-0 resize-none border-transparent px-2 py-1 text-xl font-semibold shadow-none hover:bg-surface-hover md:text-xl"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Leaving the field with an invalid title discards the change.
          if (dirty && !commit()) {
            setValue(title);
            setError(null);
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface DescriptionFieldProps {
  description: string | null;
  readOnly: boolean;
  /** Returns a validation error, or `null` when the description was accepted. */
  onSave: (description: string) => string | null;
}

/** The description: saved when leaving the field; Escape discards the change. */
function DescriptionField({ description, readOnly, onSave }: DescriptionFieldProps) {
  const saved = description ?? '';
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const fieldId = useId();
  const dirty = value !== saved;

  if (readOnly) {
    return (
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold text-subtle">Description</h3>
        <p className={cn('text-sm whitespace-pre-wrap break-words', !description && 'text-subtle')}>
          {description ?? 'No description'}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} className="text-xs font-semibold text-subtle">
        Description
      </Label>
      <Textarea
        id={fieldId}
        value={value}
        placeholder="Add a description..."
        {...{ [DIRTY_FIELD_ATTRIBUTE]: dirty ? '' : undefined }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="min-h-32"
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && dirty) {
            setValue(saved);
            setError(null);
          }
        }}
        onBlur={() => {
          if (dirty) {
            const saveError = onSave(value);
            setError(saveError);
            if (!saveError) {
              setValue(value.trim());
            }
          }
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
