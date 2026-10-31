import { describe, expect, it } from 'vitest';
import { formatPaise } from '../src/format/money.js';

describe('formatPaise', () => {
  it.each([
    [0, '₹0.00'],
    [1, '₹0.01'],
    [99, '₹0.99'],
    [100, '₹1.00'],
    [123450, '₹1,234.50'],
    [10000000, '₹1,00,000.00'],
    [-123450, '-₹1,234.50'],
    [-1, '-₹0.01'],
  ])('formats %i paise as %s', (paise, expected) => {
    expect(formatPaise(paise)).toBe(expected);
  });

  it('keeps every paisa on amounts too large for float division', () => {
    // 2^53 - 1 paise; dividing by 100 as a float would round the last digits.
    expect(formatPaise(Number.MAX_SAFE_INTEGER)).toBe('₹9,00,71,99,25,47,409.91');
  });

  it('refuses a fraction of a paisa or a non-number', () => {
    expect(() => formatPaise(1.5)).toThrow(RangeError);
    expect(() => formatPaise(Number.NaN)).toThrow(RangeError);
  });
});
