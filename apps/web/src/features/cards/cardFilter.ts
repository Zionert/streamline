import type { Card } from '@streamline/shared';

/** View-only filter of the board toolbar. */
export interface CardFilter {
  /** Matched case-insensitively against the title and the key (e.g. `SL-12`). */
  text: string;
  /** When not empty, only cards assigned to one of these users are shown. */
  assigneeIds: ReadonlySet<string>;
}

export function isFilterActive(filter: CardFilter): boolean {
  return filter.text.trim() !== '' || filter.assigneeIds.size > 0;
}

/** Whether the card passes the filter. */
export function matchesFilter(card: Card, filter: CardFilter): boolean {
  const text = filter.text.trim().toLocaleLowerCase('en-GB');
  if (
    text !== '' &&
    !card.title.toLocaleLowerCase('en-GB').includes(text) &&
    !card.key.toLocaleLowerCase('en-GB').includes(text)
  ) {
    return false;
  }
  if (filter.assigneeIds.size > 0) {
    return card.assigneeId !== null && filter.assigneeIds.has(card.assigneeId);
  }
  return true;
}

/** The cards passing the filter (the same list when the filter is not active). */
export function filterCards(cards: readonly Card[], filter: CardFilter): readonly Card[] {
  return isFilterActive(filter) ? cards.filter((card) => matchesFilter(card, filter)) : cards;
}
