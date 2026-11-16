import { ACTIVITY_TYPES, type ActivityContent } from '@streamline/shared';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { activityWith } from '@/test/fixtures';

import { ActivityItem, type ActivityItemProps } from './ActivityItem';

const card = { key: 'SB-12', title: 'Fix login' };
const todo = { id: 'col-todo', name: 'To Do' };
const progress = { id: 'col-progress', name: 'In Progress' };
const ola = { id: 'user-ola', name: 'Ola Nowak' };
const now = new Date('2026-11-11T10:05:00.000Z');

function renderItem(props: ActivityItemProps) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ul>
          <ActivityItem now={now} {...props} />
        </ul>
      ),
    },
    { path: '/boards/:boardId/cards/:cardKey', element: <p>Card page</p> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

const text = () => screen.getByTestId('activity-text').textContent;

const cases: [string, ActivityContent, string][] = [
  [
    'CARD_CREATED',
    { type: 'CARD_CREATED', payload: { card, column: todo } },
    'Jan Kowalski created SB-12 Fix login in To Do',
  ],
  [
    'CARD_UPDATED (title only)',
    {
      type: 'CARD_UPDATED',
      payload: { card, fields: ['title'], title: { from: 'Login bug', to: 'Fix login' } },
    },
    'Jan Kowalski renamed SB-12 Fix login (was “Login bug”)',
  ],
  [
    'CARD_UPDATED (several fields)',
    {
      type: 'CARD_UPDATED',
      payload: { card, fields: ['description', 'priority', 'assigneeId', 'dueDate'] },
    },
    'Jan Kowalski changed the description, priority, assignee and due date of SB-12 Fix login',
  ],
  [
    'CARD_MOVED',
    { type: 'CARD_MOVED', payload: { card, from: todo, to: progress } },
    'Jan Kowalski moved SB-12 Fix login from To Do to In Progress',
  ],
  [
    'CARD_DELETED',
    { type: 'CARD_DELETED', payload: { card, column: progress } },
    'Jan Kowalski deleted SB-12 Fix login from In Progress',
  ],
  [
    'CARD_LABEL_ADDED',
    {
      type: 'CARD_LABEL_ADDED',
      payload: { card, label: { id: 'l1', name: 'Bug', color: 'RED' } },
    },
    'Jan Kowalski added the label Bug to SB-12 Fix login',
  ],
  [
    'CARD_LABEL_REMOVED',
    {
      type: 'CARD_LABEL_REMOVED',
      payload: { card, label: { id: 'l1', name: 'Bug', color: 'RED' } },
    },
    'Jan Kowalski removed the label Bug from SB-12 Fix login',
  ],
  [
    'COMMENT_ADDED',
    { type: 'COMMENT_ADDED', payload: { card, commentId: 'c1' } },
    'Jan Kowalski commented on SB-12 Fix login',
  ],
  [
    'COLUMN_CREATED',
    { type: 'COLUMN_CREATED', payload: { column: todo } },
    'Jan Kowalski created the column To Do',
  ],
  [
    'COLUMN_RENAMED',
    {
      type: 'COLUMN_RENAMED',
      payload: { column: progress, name: { from: 'Doing', to: 'In Progress' } },
    },
    'Jan Kowalski renamed the column Doing to In Progress',
  ],
  [
    'COLUMN_MOVED',
    { type: 'COLUMN_MOVED', payload: { column: todo } },
    'Jan Kowalski moved the column To Do',
  ],
  [
    'COLUMN_SETTINGS_CHANGED',
    {
      type: 'COLUMN_SETTINGS_CHANGED',
      payload: {
        column: progress,
        changes: {
          category: { from: 'TODO', to: 'IN_PROGRESS' },
          wipLimit: { from: null, to: 3 },
          wipStrict: { from: false, to: true },
        },
      },
    },
    'Jan Kowalski changed the settings of the column In Progress: category To do → In progress, WIP limit none → 3, strict WIP limit off → on',
  ],
  [
    'COLUMN_DELETED',
    { type: 'COLUMN_DELETED', payload: { column: todo } },
    'Jan Kowalski deleted the column To Do',
  ],
  [
    'MEMBER_ADDED',
    { type: 'MEMBER_ADDED', payload: { member: ola, role: 'MEMBER' } },
    'Jan Kowalski added Ola Nowak as Member',
  ],
  [
    'MEMBER_ROLE_CHANGED',
    {
      type: 'MEMBER_ROLE_CHANGED',
      payload: { member: ola, role: { from: 'MEMBER', to: 'ADMIN' } },
    },
    'Jan Kowalski changed the role of Ola Nowak from Member to Admin',
  ],
  [
    'MEMBER_REMOVED',
    { type: 'MEMBER_REMOVED', payload: { member: ola, role: 'VIEWER' } },
    'Jan Kowalski removed Ola Nowak from the board',
  ],
  [
    'MEMBER_LEFT',
    { type: 'MEMBER_LEFT', payload: { member: ola, role: 'MEMBER' } },
    'Ola Nowak left the board',
  ],
];

describe('ActivityItem', () => {
  it.each(cases)('describes %s', (_type, content, expected) => {
    renderItem({ activity: activityWith(content, { id: 'a1' }) });

    expect(text()?.replace(/\s+/g, ' ').trim()).toBe(expected);
  });

  it('covers every activity type', () => {
    const covered = new Set(cases.map(([, content]) => content.type));
    expect(covered.size).toBe(ACTIVITY_TYPES.length);
    expect([...covered].sort()).toEqual([...ACTIVITY_TYPES].sort());
  });

  it('names a deleted actor "Deleted user"', () => {
    renderItem({
      activity: activityWith(
        { type: 'COLUMN_CREATED', payload: { column: todo } },
        { id: 'a1', actor: null },
      ),
    });

    expect(text()).toMatch(/^Deleted user created the column To Do/);
    expect(screen.getByRole('img', { name: 'Deleted user' })).toBeInTheDocument();
  });

  it('shows the time relative to now with the exact time as the tooltip', () => {
    renderItem({
      activity: activityWith(
        { type: 'COLUMN_CREATED', payload: { column: todo } },
        { id: 'a1', createdAt: '2026-11-11T10:00:00.000Z' },
      ),
    });

    const time = screen.getByText('5 minutes ago');
    expect(time).toHaveAttribute('datetime', '2026-11-11T10:00:00.000Z');
    expect(time.getAttribute('title')).toMatch(/11 Nov 2026/);
  });

  it('links a card still on the board by its current key', () => {
    const onNavigate = vi.fn();
    const router = renderItem({
      activity: activityWith(
        { type: 'CARD_MOVED', payload: { card, from: todo, to: progress } },
        { id: 'a1', cardId: 'card-12' },
      ),
      currentCardKey: 'NEW-12',
      onNavigate,
    });

    const link = screen.getByRole('link', { name: /NEW-12 Fix login/ });
    link.click();

    expect(onNavigate).toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/boards/board-1/cards/NEW-12');
  });

  it('does not link a deleted card', () => {
    renderItem({
      activity: activityWith(
        { type: 'CARD_DELETED', payload: { card, column: todo } },
        { id: 'a1', cardId: 'card-12' },
      ),
      currentCardKey: null,
    });

    expect(screen.queryByRole('link')).toBeNull();
  });
});
