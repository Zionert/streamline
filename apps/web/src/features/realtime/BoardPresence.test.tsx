import type { PublicUser } from '@streamline/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { testUser } from '@/test/fixtures';

import { BoardPresence, PRESENCE_MAX_VISIBLE } from './BoardPresence';

function users(count: number): PublicUser[] {
  return Array.from({ length: count }, (_, index) => ({
    ...testUser,
    id: `user-${index + 1}`,
    name: `Person ${index + 1}`,
    email: `person${index + 1}@example.com`,
  }));
}

describe('BoardPresence', () => {
  it('renders nothing when nobody is present', () => {
    const { container } = render(<BoardPresence users={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows an avatar with the name as tooltip for each user', () => {
    render(<BoardPresence users={users(2)} />);

    const group = screen.getByRole('group', { name: 'Users viewing this board' });
    const avatars = within(group).getAllByRole('img');
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
      'Person 1',
      'Person 2',
    ]);
    expect(avatars[0]).toHaveAttribute('title', 'Person 1');
    expect(screen.getByText('Viewing now')).toBeTruthy();
  });

  it('collapses users beyond the limit into a "+N" counter listing their names', () => {
    render(<BoardPresence users={users(PRESENCE_MAX_VISIBLE + 2)} />);

    const group = screen.getByRole('group', { name: 'Users viewing this board' });
    expect(within(group).getByRole('img', { name: 'Person 4' })).toBeTruthy();
    expect(within(group).queryByRole('img', { name: 'Person 5' })).toBeNull();
    const overflow = within(group).getByRole('img', { name: '2 more: Person 5, Person 6' });
    expect(overflow).toHaveTextContent('+2');
    expect(overflow).toHaveAttribute('title', 'Person 5, Person 6');
  });
});
