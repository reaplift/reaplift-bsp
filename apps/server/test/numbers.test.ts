import { describe, expect, it } from 'vitest';
import { cleanNumber, cleanRows } from '../src/modules/campaigns/numbers.js';

const CASES: Array<[unknown, string]> = [
  ['98123 45678', '919812345678'],
  ['+91-98123-45678', '919812345678'],
  ['09812345678', '919812345678'],
  ['00919812345678', '919812345678'],
  ['9812345678.0', '919812345678'],
  ['919812345678', '919812345678'],
  ['+919812345678', '919812345678'],
  ['(98123) 45678', '919812345678'],
  ['98.12.34.56.78', '919812345678'],
  ['6012345678', '916012345678'],
  ['7012345678', '917012345678'],
  ['8012345678', '918012345678'],
  [9812345678, '919812345678'],
  [919812345678, '919812345678'],
  ['9.81234E+09', 'scientific_notation'],
  ['9.19812E+11', 'scientific_notation'],
  ['5812345678', 'not_mobile'],
  ['915812345678', 'not_mobile'],
  ['12345', 'too_short'],
  ['91981234', 'too_short'],
  ['+447911123456', 'wrong_country'],
  ['00447911123456', 'wrong_country'],
  ['447911123456', 'wrong_country'],
  ['', 'empty'],
  ['   ', 'empty'],
  [null, 'empty'],
  ['abc', 'not_a_number'],
  ['98123x45678', 'not_a_number'],
  ['98123456789012', 'too_long'],
  ['9198123456789', 'too_long'],
];

describe('7.2 cleaning a number', () => {
  it.each(CASES)('%s becomes %s', (raw, expected) => {
    const result = cleanNumber(raw);
    expect('number' in result ? result.number : result.reason).toBe(expected);
  });

  it('a repeat points to the first row, including across formats', () => {
    const cleaned = cleanRows([
      { row: 4, value: '98123 45678' },
      { row: 5, value: 'nope' },
      { row: 9, value: '+919812345678' },
    ]);
    expect(cleaned[0]).toMatchObject({ number: '919812345678', duplicateOfRow: null });
    expect(cleaned[1]).toMatchObject({ number: null, invalidReason: 'not_a_number' });
    expect(cleaned[2]).toMatchObject({ number: null, duplicateOfRow: 4, invalidReason: null });
  });
});
