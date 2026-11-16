import { describe, expect, it } from 'vitest';

import { cardWith, labelWith } from '@/test/fixtures';

import {
  labelsOfCard,
  orderLabelIds,
  removeLabelFromCards,
  toggleLabelId,
  upsertLabel,
} from './labelOrder';

const bug = labelWith({ id: 'bug', name: 'Bug', color: 'RED' });
const ui = labelWith({ id: 'ui', name: 'UI', color: 'BLUE' });
const docs = labelWith({ id: 'docs', name: 'Docs', color: 'GRAY' });
const labels = [bug, ui, docs];

describe('label order', () => {
  it('orders ids like the board labels, unknown ids last', () => {
    expect(orderLabelIds(['docs', 'x', 'bug', 'bug'], labels)).toEqual(['bug', 'docs', 'x']);
  });

  it('toggles one label keeping the board order', () => {
    expect(toggleLabelId(['docs'], 'bug', true, labels)).toEqual(['bug', 'docs']);
    expect(toggleLabelId(['bug', 'docs'], 'bug', true, labels)).toEqual(['bug', 'docs']);
    expect(toggleLabelId(['bug', 'docs'], 'bug', false, labels)).toEqual(['docs']);
  });

  it('adds a new label at the end and replaces a known one unless it is older', () => {
    expect(upsertLabel([bug], ui)).toEqual([bug, ui]);
    const renamed = { ...bug, name: 'Defect', updatedAt: '2026-11-12T10:00:00.000Z' };
    expect(upsertLabel([bug, ui], renamed)).toEqual([renamed, ui]);
    const current = [renamed, ui];
    expect(upsertLabel(current, bug)).toBe(current);
    expect(upsertLabel(upsertLabel([bug], ui), ui)).toEqual([bug, ui]);
  });

  it('removes a deleted label from every card, keeping untouched columns', () => {
    const c1 = cardWith({ id: 'c1', number: 1, columnId: 'A', rank: 'a', labelIds: ['bug', 'ui'] });
    const c2 = cardWith({ id: 'c2', number: 2, columnId: 'A', rank: 'b' });
    const c3 = cardWith({ id: 'c3', number: 3, columnId: 'B', rank: 'a', labelIds: ['ui'] });
    const cards = { A: [c1, c2], B: [c3] };

    const result = removeLabelFromCards(cards, 'bug');

    expect(result.A?.[0]?.labelIds).toEqual(['ui']);
    expect(result.A?.[1]).toBe(c2);
    expect(result.B).toBe(cards.B);
    expect(removeLabelFromCards(cards, 'docs')).toBe(cards);
  });

  it('resolves the labels of a card, skipping unknown ids', () => {
    const card = cardWith({ id: 'c', number: 1, columnId: 'A', rank: 'a', labelIds: ['ui', 'x'] });
    expect(labelsOfCard(card, new Map(labels.map((label) => [label.id, label])))).toEqual([ui]);
  });
});
