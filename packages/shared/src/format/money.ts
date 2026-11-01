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

/** "12.34" as a whole number of hundredths, with whole-number maths only; null when it is not such a number. */
function parseHundredths(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(value) ? value : null;
}

/** Typed rupees to whole paise: "1.05" gives 105. Null for anything else, such as "1.005" or "abc". */
export function rupeesToPaise(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const value = parseHundredths(negative ? trimmed.slice(1) : trimmed);
  return value === null ? null : negative ? -value : value;
}

/** Typed percent to basis points: "22.5" gives 2250. */
export const percentToBp = (text: string): number | null => parseHundredths(text);

/** Typed paise with up to two decimals to hundredths of a paisa: "86.31" gives 8631. */
export const paiseToCentipaise = (text: string): number | null => parseHundredths(text);

/** 2250 gives "22.5%". */
export function formatPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${rest ? `.${rest}` : ''}%`;
}

/** 8631 gives "86.31 paise". */
export function formatCentipaise(centipaise: number): string {
  return `${Math.floor(centipaise / 100)}.${String(centipaise % 100).padStart(2, '0')} paise`;
}
