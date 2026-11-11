import { Prisma, type User } from '../generated/prisma/client.js';
import type { DbClient } from './db.js';

export type { User };

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Returns `null` when a user with the same email already exists. */
  create(data: CreateUserData): Promise<User | null>;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export function createUserRepository(db: DbClient): UserRepository {
  return {
    findById(id) {
      return db.user.findUnique({ where: { id } });
    },

    findByEmail(email) {
      return db.user.findUnique({ where: { email } });
    },

    async create(data) {
      try {
        return await db.user.create({ data });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === UNIQUE_CONSTRAINT_VIOLATION
        ) {
          return null;
        }
        throw err;
      }
    },
  };
}
