import type { Column } from '@streamline/shared';

/** Raw values of the column settings form. */
export interface ColumnSettingsFormValues {
  category: string;
  /** Text of the WIP limit field; empty means "no limit". */
  wipLimit: string;
  wipStrict: boolean;
}

/**
 * Settings that differ from the column's saved ones, still unvalidated: the result is meant to be
 * parsed with `updateColumnSettingsSchema`. An empty WIP limit becomes `null` (no limit).
 */
export function buildSettingsChanges(
  column: Column,
  values: ColumnSettingsFormValues,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (values.category !== column.category) {
    changes.category = values.category;
  }
  const trimmedLimit = values.wipLimit.trim();
  const wipLimit = trimmedLimit === '' ? null : Number(trimmedLimit);
  if (wipLimit !== column.wipLimit) {
    changes.wipLimit = wipLimit;
  }
  if (values.wipStrict !== column.wipStrict) {
    changes.wipStrict = values.wipStrict;
  }
  return changes;
}
