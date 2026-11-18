import type { Card, CardPriority } from '@streamline/shared';

export const PRIORITY_LABELS: Readonly<Record<CardPriority, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/**
 * Accessible name of a card tile: key and title first, then priority, assignee, labels and
 * whether the card is aging (`agingDays`: its age in days, `null` when it is not aging).
 */
export function cardTileLabel(
  card: Card,
  assigneeName: string | null,
  labelNames: readonly string[] = [],
  agingDays: number | null = null,
): string {
  const priority = `priority ${PRIORITY_LABELS[card.priority]}`;
  const person = assigneeName === null ? 'unassigned' : `assigned to ${assigneeName}`;
  const labels = labelNames.length === 0 ? '' : `, labels ${labelNames.join(', ')}`;
  const aging = agingDays === null ? '' : `, aging: ${agingDescription(agingDays).toLowerCase()}`;
  return `${card.key} ${card.title}, ${priority}, ${person}${labels}${aging}`;
}

/** Whole days of the age of a card in progress, e.g. `6d`; `<1d` below a day. */
export function agingShortLabel(ageDays: number): string {
  const days = Math.floor(ageDays);
  return days < 1 ? '<1d' : `${String(days)}d`;
}

/** E.g. `In progress for 6 days`. */
export function agingDescription(ageDays: number): string {
  const days = Math.floor(ageDays);
  if (days < 1) {
    return 'In progress for less than a day';
  }
  return `In progress for ${String(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** Priorities with a visible marker on the board; LOW and MEDIUM stay unmarked (less noise). */
export const MARKED_PRIORITIES = ['HIGH', 'URGENT'] as const satisfies readonly CardPriority[];

export type MarkedPriority = (typeof MARKED_PRIORITIES)[number];

export function isMarkedPriority(priority: CardPriority): priority is MarkedPriority {
  return (MARKED_PRIORITIES as readonly CardPriority[]).includes(priority);
}
