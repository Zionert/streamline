import { describe, expect, it } from 'vitest';

import {
  createLabelSchema,
  LABEL_COLORS,
  LABEL_ERROR_CODES,
  LABEL_NAME_MAX_LENGTH,
  labelColorSchema,
  labelListResponseSchema,
  labelNameSchema,
  labelResponseSchema,
  labelSchema,
  updateLabelSchema,
} from './label.js';

const TIMESTAMP = '2026-11-15T10:00:00.000Z';

const validLabel = {
  id: 'label-1',
  boardId: 'board-1',
  name: 'Bug',
  color: 'RED',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

describe('labelColorSchema', () => {
  it('has a fixed palette of ten unique colors', () => {
    expect(LABEL_COLORS).toHaveLength(10);
    expect(new Set(LABEL_COLORS).size).toBe(LABEL_COLORS.length);
  });

  it.each(LABEL_COLORS)('accepts %s', (color) => {
    expect(labelColorSchema.parse(color)).toBe(color);
  });

  it.each(['red', '#ff0000', '', 'BLACK'])('rejects %j', (color) => {
    expect(labelColorSchema.safeParse(color).success).toBe(false);
  });
});

describe('labelNameSchema', () => {
  it('trims the name', () => {
    expect(labelNameSchema.parse('  Needs review ')).toBe('Needs review');
  });

  it('accepts the maximum length', () => {
    const name = 'x'.repeat(LABEL_NAME_MAX_LENGTH);
    expect(labelNameSchema.parse(name)).toBe(name);
  });

  it.each(['', '   ', 'x'.repeat(LABEL_NAME_MAX_LENGTH + 1)])('rejects %j', (name) => {
    expect(labelNameSchema.safeParse(name).success).toBe(false);
  });
});

describe('createLabelSchema', () => {
  it('requires a name and a color', () => {
    expect(createLabelSchema.parse({ name: ' Bug ', color: 'RED' })).toEqual({
      name: 'Bug',
      color: 'RED',
    });
  });

  it.each([{ name: 'Bug' }, { color: 'RED' }, { name: 'Bug', color: 'RED', boardId: 'b' }])(
    'rejects %j',
    (body) => {
      expect(createLabelSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('updateLabelSchema', () => {
  it.each([{ name: 'Feature' }, { color: 'BLUE' }, { name: 'Feature', color: 'BLUE' }])(
    'accepts %j',
    (body) => {
      expect(updateLabelSchema.safeParse(body).success).toBe(true);
    },
  );

  it.each([{}, { name: '' }, { color: 'blue' }, { id: 'x' }])('rejects %j', (body) => {
    expect(updateLabelSchema.safeParse(body).success).toBe(false);
  });
});

describe('label response schemas', () => {
  it('accepts a label and a list', () => {
    expect(labelResponseSchema.parse({ label: validLabel }).label).toEqual(validLabel);
    expect(labelListResponseSchema.parse({ labels: [validLabel] }).labels).toHaveLength(1);
  });

  it('rejects an unknown color', () => {
    expect(labelSchema.safeParse({ ...validLabel, color: 'BLACK' }).success).toBe(false);
  });
});

describe('LABEL_ERROR_CODES', () => {
  it('uses the key as the code', () => {
    for (const [key, value] of Object.entries(LABEL_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
