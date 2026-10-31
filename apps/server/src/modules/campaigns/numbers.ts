export type InvalidReason =
  | 'empty'
  | 'not_a_number'
  | 'too_short'
  | 'too_long'
  | 'not_mobile'
  | 'scientific_notation'
  | 'wrong_country';

export type CleanResult = { number: string } | { reason: InvalidReason };

const COUNTRY = '91';
const MOBILE_LENGTH = 10;
const isMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/** India's rules (M7 7.2). Only clear formatting is fixed; nothing is guessed. */
export function cleanNumber(raw: unknown): CleanResult {
  const text = String(raw ?? '').trim();
  if (!text) return { reason: 'empty' };
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(text)) return { reason: 'scientific_notation' };

  const stripped = text.replace(/\.0+$/, '').replace(/[\s\-.()]/g, '');
  if (!stripped) return { reason: 'empty' };
  if (!/^\+?\d+$/.test(stripped)) return { reason: 'not_a_number' };

  const international = stripped.startsWith('+') || stripped.startsWith('00');
  let digits = stripped.replace(/^\+/, '').replace(/^00/, '');
  if (!international && digits.length === MOBILE_LENGTH + 1 && digits.startsWith('0')) digits = digits.slice(1);

  if (international && !digits.startsWith(COUNTRY)) return { reason: 'wrong_country' };
  if (!international && digits.length === MOBILE_LENGTH) {
    return isMobile(digits) ? { number: COUNTRY + digits } : { reason: 'not_mobile' };
  }
  if (digits.length < MOBILE_LENGTH) return { reason: 'too_short' };
  if (digits.startsWith(COUNTRY)) {
    const local = digits.slice(COUNTRY.length);
    if (local.length < MOBILE_LENGTH) return { reason: 'too_short' };
    if (local.length > MOBILE_LENGTH) return { reason: 'too_long' };
    return isMobile(local) ? { number: digits } : { reason: 'not_mobile' };
  }
  return digits.length === MOBILE_LENGTH + COUNTRY.length ? { reason: 'wrong_country' } : { reason: 'too_long' };
}

export interface CleanedRow {
  row: number;
  number: string | null;
  invalidReason: InvalidReason | null;
  duplicateOfRow: number | null;
}

/** Cleans a column of a list; a repeat points to the first row that had the number. */
export function cleanRows(rows: Array<{ row: number; value: unknown }>): CleanedRow[] {
  const firstSeen = new Map<string, number>();
  return rows.map(({ row, value }) => {
    const result = cleanNumber(value);
    if ('reason' in result) return { row, number: null, invalidReason: result.reason, duplicateOfRow: null };
    const first = firstSeen.get(result.number);
    if (first !== undefined) return { row, number: null, invalidReason: null, duplicateOfRow: first };
    firstSeen.set(result.number, row);
    return { row, number: result.number, invalidReason: null, duplicateOfRow: null };
  });
}
