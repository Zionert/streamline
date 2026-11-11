import { describe, expect, it } from 'vitest';

import { Prisma } from '../generated/prisma/client.js';
import { isUniqueViolationOf, postgresErrorCode } from './prisma-errors.js';

const RANK = { name: 'Column_boardId_rank_key', fields: ['boardId', 'rank'] };

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test', meta });
}

function adapterMeta(cause: Record<string, unknown>) {
  return { driverAdapterError: Object.assign(new Error('driver'), { cause }) };
}

describe('isUniqueViolationOf', () => {
  it.each([
    ['the constraint name in meta.target', { target: 'Column_boardId_rank_key' }],
    ['the fields in meta.target', { target: ['rank', 'boardId'] }],
    ['the index reported by the driver adapter', adapterMeta({ constraint: { index: RANK.name } })],
    [
      'the fields reported by the driver adapter',
      adapterMeta({ constraint: { fields: ['boardId', 'rank'] } }),
    ],
  ])('recognises %s', (_label, meta) => {
    expect(isUniqueViolationOf(knownError('P2002', meta), RANK)).toBe(true);
  });

  it.each([
    ['another constraint name', { target: 'Column_title_key' }],
    ['other fields', { target: ['boardId'] }],
    [
      'another index from the driver adapter',
      adapterMeta({ constraint: { index: 'Column_pkey' } }),
    ],
    ['no constraint details', undefined],
  ])('rejects %s', (_label, meta) => {
    expect(isUniqueViolationOf(knownError('P2002', meta), RANK)).toBe(false);
  });

  it('rejects other errors', () => {
    expect(isUniqueViolationOf(knownError('P2025', { target: RANK.name }), RANK)).toBe(false);
    expect(isUniqueViolationOf(new Error('Column_boardId_rank_key'), RANK)).toBe(false);
  });
});

describe('postgresErrorCode', () => {
  it('reads the SQLSTATE reported by the driver adapter', () => {
    const meta = adapterMeta({ originalCode: '55P03', kind: 'postgres', code: '55P03' });
    expect(postgresErrorCode(knownError('P2010', meta))).toBe('55P03');
    expect(postgresErrorCode(knownError('P2039', adapterMeta({ code: '40001' })))).toBe('40001');
  });

  it('returns undefined without driver details', () => {
    expect(postgresErrorCode(knownError('P2028'))).toBeUndefined();
    expect(postgresErrorCode(new Error('55P03'))).toBeUndefined();
  });
});
