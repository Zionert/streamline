import { updateCardSchema, type Card, type UpdateCardInput } from '@streamline/shared';

/** Editable fields of a card as entered in the details form (before validation). */
export interface CardDraft {
  title?: string;
  description?: string | null;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export type CardChangesResult =
  { ok: true; changes: UpdateCardInput | null } | { ok: false; error: string };

/**
 * Validates the draft with the shared schema and keeps only the fields that differ from the card,
 * so a save sends only what changed. `changes` is `null` when nothing changed.
 */
export function getCardChanges(card: Card, draft: CardDraft): CardChangesResult {
  const parsed = updateCardSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid value' };
  }
  const values = parsed.data;
  const changes: UpdateCardInput = {
    ...(values.title !== undefined && values.title !== card.title ? { title: values.title } : {}),
    ...(values.description !== undefined && values.description !== card.description
      ? { description: values.description }
      : {}),
    ...(values.priority !== undefined && values.priority !== card.priority
      ? { priority: values.priority }
      : {}),
    ...(values.assigneeId !== undefined && values.assigneeId !== card.assigneeId
      ? { assigneeId: values.assigneeId }
      : {}),
    ...(values.dueDate !== undefined && values.dueDate !== card.dueDate
      ? { dueDate: values.dueDate }
      : {}),
  };
  return { ok: true, changes: Object.keys(changes).length > 0 ? changes : null };
}
