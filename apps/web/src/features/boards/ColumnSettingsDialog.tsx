import {
  COLUMN_CATEGORIES,
  COLUMN_WIP_LIMIT_MAX,
  COLUMN_WIP_LIMIT_MIN,
  updateColumnSettingsSchema,
  type Column,
} from '@streamline/shared';
import { useState, type FormEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useBoardStore } from '@/stores/board';

import { getBoardErrorMessage } from './boardErrorMessage';
import { buildSettingsChanges } from './columnSettings';
import { CATEGORY_LABELS } from './labels';

const WIP_LIMIT_ERROR = `WIP limit must be a whole number from ${COLUMN_WIP_LIMIT_MIN} to ${COLUMN_WIP_LIMIT_MAX}, or empty for no limit.`;

interface ColumnSettingsDialogProps {
  column: Column;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives focus when the dialog closes (the menu button the dialog was opened from). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Category, WIP limit and strict mode of a column (OWNER and ADMIN only). */
export function ColumnSettingsDialog({
  column,
  open,
  onOpenChange,
  returnFocusRef,
}: ColumnSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Column settings</DialogTitle>
          <DialogDescription>
            Workflow category and WIP limit of "{column.title}".
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form starts from the saved settings every time. */}
        {open && <ColumnSettingsForm column={column} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ColumnSettingsForm({ column, onDone }: { column: Column; onDone: () => void }) {
  const updateColumnSettings = useBoardStore((state) => state.updateColumnSettings);
  const [category, setCategory] = useState<string>(column.category);
  const [wipLimit, setWipLimit] = useState(column.wipLimit === null ? '' : String(column.wipLimit));
  const [wipStrict, setWipStrict] = useState(column.wipStrict);
  const [wipLimitError, setWipLimitError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWipLimitError(null);
    setFormError(null);
    const changes = buildSettingsChanges(column, { category, wipLimit, wipStrict });
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    const parsed = updateColumnSettingsSchema.safeParse(changes);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (issue?.path[0] === 'wipLimit') {
        setWipLimitError(WIP_LIMIT_ERROR);
      } else {
        setFormError(issue?.message ?? 'Invalid settings');
      }
      return;
    }
    setIsSubmitting(true);
    try {
      await updateColumnSettings(column.id, parsed.data);
      onDone();
    } catch (error) {
      setFormError(getBoardErrorMessage(error));
      setIsSubmitting(false);
    }
  };

  return (
    <form noValidate className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor="column-category">Category</Label>
        <NativeSelect
          id="column-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {COLUMN_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="column-wip-limit">WIP limit</Label>
        <Input
          id="column-wip-limit"
          type="number"
          inputMode="numeric"
          min={COLUMN_WIP_LIMIT_MIN}
          max={COLUMN_WIP_LIMIT_MAX}
          placeholder="No limit"
          value={wipLimit}
          aria-invalid={wipLimitError ? true : undefined}
          aria-describedby={wipLimitError ? 'column-wip-limit-error' : undefined}
          onChange={(event) => setWipLimit(event.target.value)}
        />
        {wipLimitError && (
          <p id="column-wip-limit-error" role="alert" className="text-sm text-destructive">
            {wipLimitError}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="column-wip-strict"
          checked={wipStrict}
          onCheckedChange={(checked) => setWipStrict(checked === true)}
        />
        <Label htmlFor="column-wip-strict">
          Strict WIP limit (block adding cards over the limit)
        </Label>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          Save settings
        </Button>
      </DialogFooter>
    </form>
  );
}
