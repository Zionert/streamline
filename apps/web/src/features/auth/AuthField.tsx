import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type AuthFieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
};

/** Labelled input with a field-level error message linked via `aria-describedby`. */
export function AuthField({ id, label, error, ...inputProps }: AuthFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
