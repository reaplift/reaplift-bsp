import ExcelJS from 'exceljs';

export const CSV_TYPE = 'text/csv';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class UnreadableFileError extends Error {}
export class TooManyRowsError extends Error {}

export interface ParsedRow {
  /** The row's number in the file, so a client can find it. */
  row: number;
  cells: string[];
}

export interface ParsedFile {
  columns: string[];
  rows: ParsedRow[];
  blankRowsSkipped: number;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return value.result === undefined ? '' : cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    return '';
  }
  return String(value);
}

/** Splits CSV text following RFC 4180: quoted fields may hold commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readXlsx(bytes: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new UnreadableFileError('This Excel file cannot be read');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new UnreadableFileError('This Excel file has no sheet');
  // Both counts scan the whole sheet, so they are read once, not once per row.
  const rowCount = sheet.rowCount;
  const columnCount = sheet.columnCount;
  const rows: string[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= columnCount; c++) cells.push(cellText(row.getCell(c).value).trim());
    rows.push(cells);
  }
  return rows;
}

/** Reads a file into a header row and data rows. Blank rows are skipped and counted. */
export async function readAudienceFile(bytes: Buffer, type: string, maxRows: number): Promise<ParsedFile> {
  const all = type === XLSX_TYPE ? await readXlsx(bytes) : parseCsv(bytes.toString('utf8'));
  const headerIndex = all.findIndex((cells) => cells.some((cell) => cell.trim() !== ''));
  if (headerIndex === -1) throw new UnreadableFileError('This file is empty');

  const header = all[headerIndex]!;
  const rows: ParsedRow[] = [];
  let blankRowsSkipped = 0;
  for (let i = headerIndex + 1; i < all.length; i++) {
    const cells = all[i]!;
    if (cells.every((cell) => cell.trim() === '')) {
      blankRowsSkipped += 1;
      continue;
    }
    rows.push({ row: i + 1, cells });
    if (rows.length > maxRows) throw new TooManyRowsError(`This file has more than ${maxRows} rows`);
  }
  const width = Math.max(header.length, ...rows.slice(0, 1000).map((r) => r.cells.length));
  return {
    columns: Array.from({ length: width }, (_, i) => header[i]?.trim() || `Column ${i + 1}`),
    rows,
    blankRowsSkipped,
  };
}
