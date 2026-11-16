import type { Card, Label } from '@streamline/shared';

import type { CardsByColumn } from '@/features/cards/cardOrder';

/**
 * Pure helpers for the board's labels and the label ids carried by cards. Cards list their label
 * ids in the order of the board's label list (creation order).
 */

/** The ids ordered like the board's labels; ids of unknown labels go last, in their order. */
export function orderLabelIds(labelIds: readonly string[], labels: readonly Label[]): string[] {
  const position = new Map(labels.map((label, index) => [label.id, index]));
  const unique = [...new Set(labelIds)];
  return unique
    .map((id, index) => ({ id, key: position.get(id) ?? labels.length + index }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.id);
}

/** `labelIds` with `labelId` attached (`attach`) or removed, ordered like the board's labels. */
export function toggleLabelId(
  labelIds: readonly string[],
  labelId: string,
  attach: boolean,
  labels: readonly Label[],
): string[] {
  const others = labelIds.filter((id) => id !== labelId);
  return attach ? orderLabelIds([...others, labelId], labels) : others;
}

/**
 * Adds a new label at the end (creation order) or replaces a known one, unless the shown version
 * is newer (then the same array is returned). Idempotent.
 */
export function upsertLabel(labels: Label[], label: Label): Label[] {
  const index = labels.findIndex((entry) => entry.id === label.id);
  if (index < 0) {
    return [...labels, label];
  }
  const shown = labels[index];
  if (shown && shown.updatedAt > label.updatedAt) {
    return labels;
  }
  return labels.map((entry) => (entry.id === label.id ? label : entry));
}

/** Removes the label from every card that carries it (other cards stay the same objects). */
export function removeLabelFromCards(cardsByColumn: CardsByColumn, labelId: string): CardsByColumn {
  let changed = false;
  const result: Record<string, readonly Card[]> = {};
  for (const [columnId, cards] of Object.entries(cardsByColumn)) {
    if (!cards.some((card) => card.labelIds.includes(labelId))) {
      result[columnId] = cards;
      continue;
    }
    changed = true;
    result[columnId] = cards.map((card) =>
      card.labelIds.includes(labelId)
        ? { ...card, labelIds: card.labelIds.filter((id) => id !== labelId) }
        : card,
    );
  }
  return changed ? result : cardsByColumn;
}

/** The labels of the card, in the card's order; unknown ids are skipped. */
export function labelsOfCard(
  card: Pick<Card, 'labelIds'>,
  labelsById: ReadonlyMap<string, Label>,
): Label[] {
  return card.labelIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label] : [];
  });
}
