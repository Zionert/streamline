import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export type DbClient = PrismaClient;

/**
 * Creates the Prisma client. Only repositories may use it directly.
 * The connection is opened lazily on the first query.
 */
export function createDbClient(databaseUrl: string): DbClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
