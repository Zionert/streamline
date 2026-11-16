import type { Card, CardPriority } from '@streamline/shared';

export const PRIORITY_LABELS: Readonly<Record<CardPriority, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Accessible name of a card tile: key and title first, then priority, assignee and labels. */
export function cardTileLabel(
  card: Card,
  assigneeName: string | null,
  labelNames: readonly string[] = [],
): string {
  const priority = `priority ${PRIORITY_LABELS[card.priority]}`;
  const person = assigneeName === null ? 'unassigned' : `assigned to ${assigneeName}`;
  const labels = labelNames.length === 0 ? '' : `, labels ${labelNames.join(', ')}`;
  return `${card.key} ${card.title}, ${priority}, ${person}${labels}`;
}
