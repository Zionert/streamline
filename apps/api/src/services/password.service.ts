import { compare, hash } from 'bcryptjs';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, passwordHash: string): Promise<boolean>;
  /**
   * Performs a comparison against a fixed dummy hash and always resolves to `false`.
   * Used when the user does not exist, so that the response time does not reveal it.
   */
  verifyDummy(password: string): Promise<false>;
}

/** bcrypt password hashing (pure JavaScript `bcryptjs`, no native build required). */
export function createPasswordHasher(cost: number): PasswordHasher {
  // Created up front, so even the first unknown-email login costs exactly one comparison.
  const dummyHash = hash('streamline-dummy-password', cost);

  return {
    hash(password) {
      return hash(password, cost);
    },

    verify(password, passwordHash) {
      return compare(password, passwordHash);
    },

    async verifyDummy(password) {
      // Same cost as real hashes, so the comparison takes the same time.
      await compare(password, await dummyHash);
      return false;
    },
  };
}
