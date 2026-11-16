/**
 * Marks a text field of the card details with unsaved changes: Escape there discards the changes
 * instead of closing the dialog (a second Escape closes it).
 */
export const DIRTY_FIELD_ATTRIBUTE = 'data-dirty-field';

/** Props marking a field as dirty (spread on the field). */
export function dirtyFieldProps(dirty: boolean): Record<string, string | undefined> {
  return { [DIRTY_FIELD_ATTRIBUTE]: dirty ? '' : undefined };
}
