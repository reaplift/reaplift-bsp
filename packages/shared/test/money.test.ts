import { describe, expect, it } from 'vitest';
import { formatCentipaise, formatPaise, formatPercent, paiseToCentipaise, percentToBp, rupeesToPaise } from '../src/format/money.js';

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

describe('typed amounts', () => {
  it.each([
    ['1', 100],
    ['1.5', 150],
    ['1.05', 105],
    ['0.01', 1],
    [' 10000 ', 1000000],
    ['-50.25', -5025],
  ])('reads %s rupees as %i paise', (text, paise) => {
    expect(rupeesToPaise(text)).toBe(paise);
  });

  it.each(['1.005', 'abc', '', '1,000', '₹5', '1e3', '--1'])('refuses %s', (text) => {
    expect(rupeesToPaise(text)).toBeNull();
  });

  it('reads percent and paise rates, and shows them back', () => {
    expect(percentToBp('25')).toBe(2500);
    expect(percentToBp('22.5')).toBe(2250);
    expect(percentToBp('-1')).toBeNull();
    expect(paiseToCentipaise('86.31')).toBe(8631);
    expect(formatPercent(1800)).toBe('18%');
    expect(formatPercent(2250)).toBe('22.5%');
    expect(formatPercent(1825)).toBe('18.25%');
    expect(formatCentipaise(8631)).toBe('86.31 paise');
    expect(formatCentipaise(1150)).toBe('11.50 paise');
  });
});
