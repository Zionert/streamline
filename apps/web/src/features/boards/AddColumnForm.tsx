import { createColumnSchema } from '@streamline/shared';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBoardStore } from '@/stores/board';

import { getBoardErrorMessage } from './boardErrorMessage';

/**
 * Dashed placeholder column at the end of the board. Shows an "Add column" button that turns
 * into the form; the form stays open after a successful add, so several columns can be added.
 */
export function AddColumnGhost() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex w-[280px] shrink-0 flex-col self-start rounded-column border-2 border-dashed border-border p-2">
      {isOpen ? (
        <AddColumnForm onCancel={() => setIsOpen(false)} />
      ) : (
        <Button
          variant="ghost"
          className="w-full justify-start text-subtle"
          onClick={() => setIsOpen(true)}
        >
          <Plus strokeWidth={2} />
          Add column
        </Button>
      )}
    </div>
  );
}

/** Appends a new column at the end of the board. */
export function AddColumnForm({ onCancel }: { onCancel?: () => void }) {
  const createColumn = useBoardStore((state) => state.createColumn);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Without afterId/beforeId the server appends the column at the end.
    const parsed = createColumnSchema.safeParse({ title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createColumn(parsed.data.title);
      setTitle('');
    } catch (createError) {
      setError(getBoardErrorMessage(createError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      aria-label="Add column"
      className="flex flex-col gap-2"
      onSubmit={(event) => void handleSubmit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onCancel) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <Label htmlFor="new-column-title" className="text-xs text-subtle">
        New column
      </Label>
      <Input
        id="new-column-title"
        placeholder="Column title"
        autoFocus
        value={title}
        className="bg-surface"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'new-column-title-error' : undefined}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
        }}
      />
      {error && (
        <p id="new-column-title-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          Add column
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
