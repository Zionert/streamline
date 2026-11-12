import type { Card, CardPriority } from '@streamline/shared';

export const PRIORITY_LABELS: Readonly<Record<CardPriority, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Accessible name of a card tile: key and title first, then priority and assignee. */
export function cardTileLabel(card: Card, assigneeName: string | null): string {
  const priority = `priority ${PRIORITY_LABELS[card.priority]}`;
  const person = assigneeName === null ? 'unassigned' : `assigned to ${assigneeName}`;
  return `${card.key} ${card.title}, ${priority}, ${person}`;
}
