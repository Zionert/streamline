import type { AuthResponse, PublicUser } from '@streamline/shared';

export const testUser: PublicUser = {
  id: 'user-1',
  email: 'jan@example.com',
  name: 'Jan Kowalski',
  createdAt: '2026-11-11T10:00:00.000Z',
};

export function sessionWith(accessToken: string, user: PublicUser = testUser): AuthResponse {
  return { accessToken, user };
}
