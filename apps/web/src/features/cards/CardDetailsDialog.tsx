import {
  CARD_PRIORITIES,
  hasBoardPermission,
  type Card,
  type UpdateCardInput,
} from '@streamline/shared';
import { History, Link2, MessageSquare, Trash2, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { CardActivityFeed } from '@/features/activity/CardActivityFeed';
import { ConfirmDialog } from '@/features/boards/ConfirmDialog';
import { cardPath } from '@/features/boards/paths';
import { CommentsSection } from '@/features/comments/CommentsSection';
import { CardLabelsField } from '@/features/labels/CardLabelsField';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useBoardStore } from '@/stores/board';

import { getCardChanges, type CardDraft } from './cardChanges';
import { DIRTY_FIELD_ATTRIBUTE } from './dirtyField';
import { getCardErrorMessage } from './cardErrorMessage';
import { cardsOf } from './cardOrder';
import { formatCalendarDate, formatDateTime } from './format';
import { PRIORITY_LABELS } from './cardLabels';
import { PriorityFlag } from './priority';

/** Field labels of the details: monospace 11 px capitals in the muted text colour. */
const FIELD_LABEL_CLASS =
  'font-mono text-[11px] font-normal tracking-[0.06em] text-muted uppercase';

/** Toast ids: a newer message of the same kind replaces the previous one. */
const SAVE_ERROR_TOAST_ID = 'card-save-error';
const COPY_LINK_TOAST_ID = 'card-copy-link';

interface CardDetailsDialogProps {
  card: Card;
  onClose: () => void;
}

/**
 * Details of a card in a modal with two columns. Every field is saved on its own, sending only
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
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const canWrite = board !== null && hasBoardPermission(board.role, 'card:write');
  const boardId = board?.id ?? card.boardId;
  const ids = {
    status: useId(),
    assignee: useId(),
    priority: useId(),
    dueDate: useId(),
    labels: useId(),
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
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
          <span className="font-mono text-xs text-subtle">{card.key}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="subtle" size="sm" onClick={() => void copyLink()}>
              <Link2 strokeWidth={2} />
              Copy link
            </Button>
            {canWrite && (
              <Button
                ref={deleteButton}
                variant="subtle"
                size="sm"
                className="text-destructive"
                onClick={() => setIsDeleting(true)}
              >
                <Trash2 strokeWidth={2} />
                Delete
              </Button>
            )}
            <Button variant="subtle" size="sm" onClick={onClose}>
              <X strokeWidth={2} />
              Close
            </Button>
          </div>
        </div>
        <div className="grid md:grid-cols-[65fr_35fr]">
          <div className="flex min-w-0 flex-col gap-4 p-6">
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
            {/* Comments first (the default tab); the card's history is one click away. */}
            <Tabs defaultValue="comments" className="pt-2">
              <TabsList aria-label="Card discussion and history">
                <TabsTrigger value="comments">
                  <MessageSquare aria-hidden="true" className="size-4" strokeWidth={2} />
                  Comments
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <History aria-hidden="true" className="size-4" strokeWidth={2} />
                  Activity
                </TabsTrigger>
              </TabsList>
              {/* Kept mounted while hidden, so a comment being written survives a look at the
                  history. */}
              <TabsContent value="comments" forceMount className="data-[state=inactive]:hidden">
                {board && (
                  <CommentsSection
                    boardId={boardId}
                    cardId={card.id}
                    userId={userId}
                    role={board.role}
                  />
                )}
              </TabsContent>
              <TabsContent value="activity">
                <CardActivityFeed boardId={boardId} cardId={card.id} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex min-w-0 flex-col border-t border-border p-6 text-sm md:border-t-0 md:border-l">
            <dl className="flex flex-col gap-3">
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
                  <PriorityFlag priority={card.priority} showLabel={false} />
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
              <Field label="Labels" labelId={ids.labels}>
                <CardLabelsField card={card} canWrite={canWrite} labelledBy={ids.labels} />
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
              <Field label="Created">
                <p className="font-mono text-xs text-subtle">{formatDateTime(card.createdAt)}</p>
              </Field>
              <Field label="Updated">
                <p className="font-mono text-xs text-subtle">{formatDateTime(card.updatedAt)}</p>
              </Field>
            </dl>
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
  labelId,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** Id of the term, for values labelled by it (`aria-labelledby`). */
  labelId?: string;
  children: ReactNode;
}) {
  return (
    // Label and value side by side; stacked when the details are a single narrow column.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center sm:gap-3">
      <dt id={labelId} className={FIELD_LABEL_CLASS}>
        {htmlFor ? (
          <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
            {label}
          </Label>
        ) : (
          label
        )}
      </dt>
      <dd className="min-w-0">{children}</dd>
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
        <h3 className={FIELD_LABEL_CLASS}>Description</h3>
        <p className={cn('text-sm whitespace-pre-wrap break-words', !description && 'text-subtle')}>
          {description ?? 'No description'}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} className={FIELD_LABEL_CLASS}>
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
