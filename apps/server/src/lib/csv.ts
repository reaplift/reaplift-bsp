/** One CSV cell. A cell that a spreadsheet would run as a formula is kept as text. */
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;
