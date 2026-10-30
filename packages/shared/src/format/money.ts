const rupeeGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Whole paise to rupees for display: 123450 gives "₹1,234.50", with Indian grouping
 * ("₹1,00,000.00"). Splits rupees and paise with integer maths, so large amounts never pick up
 * floating-point error. The panel only formats money; it never does arithmetic on it.
 */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError(`formatPaise needs whole paise, got ${paise}`);
  }
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}₹${rupeeGrouping.format(rupees)}.${rest}`;
}
