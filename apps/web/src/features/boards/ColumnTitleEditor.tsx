import { renameColumnSchema } from '@streamline/shared';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { Input } from '@/components/ui/input';

interface ColumnTitleEditorProps {
  initialTitle: string;
  /** Called with the validated (trimmed) title. */
  onSave: (title: string) => void;
  onCancel: () => void;
}

/**
 * Inline title input: Enter saves (an invalid title shows the schema error and keeps editing),
 * Escape cancels, leaving the field saves a valid changed title and cancels otherwise.
 */
export function ColumnTitleEditor({ initialTitle, onSave, onCancel }: ColumnTitleEditorProps) {
  const [value, setValue] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const finished = useRef(false);
  const errorId = useId();

  const finish = (action: () => void) => {
    if (!finished.current) {
      finished.current = true;
      action();
    }
  };

  const validate = () => renameColumnSchema.safeParse({ title: value });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(onCancel);
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const parsed = validate();
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    const { title } = parsed.data;
    finish(() => (title === initialTitle ? onCancel() : onSave(title)));
  };

  const handleBlur = () => {
    const parsed = validate();
    finish(() =>
      parsed.success && parsed.data.title !== initialTitle ? onSave(parsed.data.title) : onCancel(),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label="Column title"
        autoFocus
        value={value}
        className="h-8"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
