import { createCardSchema, type Card } from '@streamline/shared';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useBoardStore } from '@/stores/board';

import { getCardErrorMessage } from './cardErrorMessage';

interface CardComposerProps {
  columnId: string;
  columnTitle: string;
  onClose: () => void;
  /** Whether a card is hidden by the active toolbar filter (a hint then explains it). */
  isHidden?: (card: Card) => boolean;
}

/**
 * Quick card creation at the bottom of a column: Enter adds the card (the composer stays open
 * for the next one), Escape closes it.
 */
export function CardComposer({ columnId, columnTitle, onClose, isHidden }: CardComposerProps) {
  const createCard = useBoardStore((state) => state.createCard);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  const submit = async () => {
    if (isSubmitting) {
      return;
    }
    const parsed = createCardSchema.safeParse({ columnId, title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setHint(null);
    try {
      const card = await createCard(parsed.data.columnId, parsed.data.title);
      setTitle('');
      if (isHidden?.(card)) {
        setHint(`${card.key} was created, but it is hidden by the current filter.`);
      }
    } catch (createError) {
      setError(getCardErrorMessage(createError));
    } finally {
      setIsSubmitting(false);
      input.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      // A card title is a single line: Enter submits instead of adding a line break.
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      noValidate
      aria-label={`Add a card to ${columnTitle}`}
      className="flex flex-col gap-2"
      onSubmit={handleSubmit}
    >
      <Textarea
        ref={input}
        aria-label="Card title"
        placeholder="What needs to be done?"
        autoFocus
        rows={2}
        value={title}
        className="min-h-14 resize-none bg-surface shadow-card"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
          setHint(null);
        }}
        onKeyDown={handleKeyDown}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {hint && (
        <p role="status" className="text-xs text-subtle">
          {hint}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          Add card
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
