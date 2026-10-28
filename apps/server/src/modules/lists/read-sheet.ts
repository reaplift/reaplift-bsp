import path from 'node:path';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { SaxesParser, type SaxesTagPlain } from 'saxes';
import unzipper from 'unzipper';
import { ListError } from './errors.js';

/** One row as read from the file. `rowNumber` is the row number Excel or Google Sheets shows. */
export interface SheetRow {
  rowNumber: number;
  cells: string[];
}

export type SheetKind = 'csv' | 'xlsx';

/**
 * A stored file that can be read whole or in parts. Excel files are zip archives whose index
 * sits at the end, so they are read by parts; local disk and Object Storage both allow that.
 */
export interface FileSource {
  size(): Promise<number>;
  /** The bytes from `offset`, `length` of them, or to the end when `length` is left out. */
  stream(offset?: number, length?: number): Readable;
}

export function bufferSource(data: Buffer): FileSource {
  return {
    size: async () => data.length,
    stream: (offset = 0, length) =>
      Readable.from([data.subarray(offset, length === undefined ? undefined : offset + length)]),
  };
}

const invalidFile = (kind: SheetKind) =>
  new ListError(
    422,
    'INVALID_FILE',
    kind === 'xlsx'
      ? 'The file could not be read as an Excel workbook. If it is password-protected, remove the password; otherwise save it as .xlsx or .csv and upload again.'
      : 'The file could not be read as CSV. Check that it is a comma-separated text file.',
  );

export function readRows(source: FileSource, kind: SheetKind): AsyncGenerator<SheetRow> {
  return kind === 'xlsx' ? readXlsxRows(source) : readCsvRows(source.stream());
}

async function* readCsvRows(input: Readable): AsyncGenerator<SheetRow> {
  const parser = input.pipe(
    parse({ bom: true, relax_column_count: true, skip_empty_lines: false }),
  );
  let rowNumber = 0;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      rowNumber += 1;
      yield { rowNumber, cells: record };
    }
  } catch (err) {
    if (err instanceof ListError) throw err;
    throw invalidFile('csv');
  } finally {
    input.destroy();
  }
}

// Shared strings are held in memory while the sheet streams; this bounds a "zip bomb".
const MAX_SHARED_STRINGS_BYTES = 200 * 1024 * 1024;

/**
 * Streams the rows of the first visible tab of an .xlsx file.
 *
 * Each part of the workbook is opened through the zip's index rather than by reading the archive
 * front to back: exceljs's front-to-back stream reader was measured dropping parts of small files
 * (shared strings, whole sheets) in most reads. The worksheet itself is parsed as a stream, so
 * 200K rows never sit in memory at once.
 */
async function* readXlsxRows(source: FileSource): AsyncGenerator<SheetRow> {
  let workbook: Awaited<ReturnType<typeof openWorkbook>>;
  try {
    workbook = await openWorkbook(source);
  } catch (err) {
    if (err instanceof ListError) throw err;
    throw invalidFile('xlsx');
  }

  const stream = workbook.sheet.stream();
  stream.setEncoding('utf8');
  const parser = new SaxesParser({ xmlns: false });
  const ready: SheetRow[] = [];

  let row: SheetRow | null = null;
  let lastRowNumber = 0;
  let column = -1;
  let cellType = '';
  let cellStyle = 0;
  let value = '';
  let inValue = false;
  let inInlineText = false;
  let inPhonetic = false;

  parser.on('opentag', (tag: SaxesTagPlain) => {
    switch (localName(tag.name)) {
      case 'row':
        lastRowNumber = Number(tag.attributes.r) || lastRowNumber + 1;
        row = { rowNumber: lastRowNumber, cells: [] };
        column = -1;
        break;
      case 'c':
        column = columnIndex(String(tag.attributes.r ?? '')) ?? column + 1;
        cellType = String(tag.attributes.t ?? 'n');
        cellStyle = Number(tag.attributes.s ?? 0);
        value = '';
        break;
      case 'v':
        inValue = true;
        break;
      case 'rPh':
        inPhonetic = true;
        break;
      case 't':
        inInlineText = !inPhonetic;
        break;
    }
  });
  parser.on('text', (text) => {
    if (inValue || inInlineText) value += text;
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    switch (localName(tag.name)) {
      case 'v':
        inValue = false;
        break;
      case 't':
        inInlineText = false;
        break;
      case 'rPh':
        inPhonetic = false;
        break;
      case 'c':
        if (row) row.cells[column] = cellValue(cellType, cellStyle, value, workbook);
        break;
      case 'row':
        if (row) {
          ready.push({ rowNumber: row.rowNumber, cells: Array.from(row.cells, (c) => c ?? '') });
          row = null;
        }
        break;
    }
  });

  try {
    for await (const chunk of stream as AsyncIterable<string>) {
      parser.write(chunk);
      // Hand over the rows this chunk completed before reading more of the file.
      while (ready.length > 0) yield ready.shift()!;
    }
    parser.close();
    while (ready.length > 0) yield ready.shift()!;
  } catch (err) {
    if (err instanceof ListError) throw err;
    throw invalidFile('xlsx');
  } finally {
    stream.destroy();
  }
}

interface Workbook {
  sheet: unzipper.File;
  sharedStrings: string[];
  dateStyles: Set<number>;
  date1904: boolean;
}

async function openWorkbook(source: FileSource): Promise<Workbook> {
  const directory = await unzipper.Open.custom(
    source as unknown as Parameters<typeof unzipper.Open.custom>[0],
  );
  const files = new Map(directory.files.map((f) => [f.path.replace(/^\/+/, ''), f]));
  const text = async (name: string) => {
    const file = files.get(name);
    return file ? (await file.buffer()).toString('utf8') : null;
  };

  const workbookXml = await text('xl/workbook.xml');
  if (workbookXml === null) throw invalidFile('xlsx');
  const rels = parseRelationships((await text('xl/_rels/workbook.xml.rels')) ?? '');
  const { sheets, date1904 } = parseWorkbook(workbookXml);

  // The first tab as shown in Excel: tab order lives in workbook.xml, not in file names.
  const tab = sheets.find((s) => s.state !== 'hidden' && s.state !== 'veryHidden') ?? sheets[0];
  const target = tab && rels.find((r) => r.id === tab.relId)?.target;
  const sheet = (target && files.get(target)) || firstWorksheetFile(files);
  if (!sheet) throw new ListError(422, 'EMPTY_LIST', 'The workbook has no worksheets.');

  const sharedStringsPath =
    rels.find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'xl/sharedStrings.xml';
  const sharedStringsFile = files.get(sharedStringsPath);
  if (sharedStringsFile && sharedStringsFile.uncompressedSize > MAX_SHARED_STRINGS_BYTES) {
    throw new ListError(
      413,
      'FILE_TOO_LARGE',
      'The workbook holds more text than can be read. Split it into smaller files.',
    );
  }
  const stylesPath = rels.find((r) => r.type.endsWith('/styles'))?.target ?? 'xl/styles.xml';

  return {
    sheet,
    sharedStrings: parseSharedStrings((await text(sharedStringsPath)) ?? ''),
    dateStyles: parseDateStyles((await text(stylesPath)) ?? ''),
    date1904,
  };
}

function firstWorksheetFile(files: Map<string, unzipper.File>) {
  const sheetNo = (name: string) =>
    Number(/^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)?.[1] ?? NaN);
  const names = [...files.keys()]
    .filter((n) => !Number.isNaN(sheetNo(n)))
    .sort((a, b) => sheetNo(a) - sheetNo(b));
  return names[0] ? files.get(names[0]) : undefined;
}

/** Runs `onTag` for every opening tag of a small XML part, with prefixes like `x:` removed. */
function eachTag(xml: string, onTag: (name: string, attributes: Record<string, string>) => void) {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) =>
    onTag(localName(tag.name), tag.attributes as Record<string, string>),
  );
  parser.write(xml).close();
}

function parseWorkbook(xml: string) {
  const sheets: Array<{ state?: string; relId?: string }> = [];
  let date1904 = false;
  eachTag(xml, (name, attributes) => {
    if (name === 'workbookPr')
      date1904 = attributes.date1904 === '1' || attributes.date1904 === 'true';
    if (name === 'sheet') {
      const relId = Object.entries(attributes).find(([key]) => key.endsWith(':id'))?.[1];
      sheets.push({ state: attributes.state, relId });
    }
  });
  return { sheets, date1904 };
}

/** Workbook relationships, with targets as zip paths ("worksheets/sheet3.xml" → "xl/worksheets/sheet3.xml"). */
function parseRelationships(xml: string) {
  const rels: Array<{ id: string; target: string; type: string }> = [];
  if (!xml) return rels;
  eachTag(xml, (name, attributes) => {
    if (name !== 'Relationship' || !attributes.Target) return;
    const target = attributes.Target.startsWith('/')
      ? attributes.Target.slice(1)
      : path.posix.normalize(path.posix.join('xl', attributes.Target));
    rels.push({ id: attributes.Id ?? '', target, type: attributes.Type ?? '' });
  });
  return rels;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  if (!xml) return strings;
  let current = '';
  let inText = false;
  let inPhonetic = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    if (name === 'si') current = '';
    else if (name === 'rPh')
      inPhonetic = true; // pronunciation guide: not part of the text
    else if (name === 't') inText = !inPhonetic;
  });
  parser.on('text', (text) => {
    if (inText) current += text;
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    if (name === 't') inText = false;
    else if (name === 'rPh') inPhonetic = false;
    else if (name === 'si') strings.push(unescapeOoxml(current));
  });
  parser.write(xml).close();
  return strings;
}

// Built-in number formats that show a date or time (ECMA-376 18.8.30, plus the East Asian ones).
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** Indexes of cell styles (`s` on a cell) whose number format shows a date. */
function parseDateStyles(xml: string): Set<number> {
  const dateFormats = new Set(BUILT_IN_DATE_FORMATS);
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;
  let inCellXfs = false;
  let xfIndex = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const name = localName(tag.name);
    const attributes = tag.attributes as Record<string, string>;
    if (name === 'numFmt' && isDateFormatCode(attributes.formatCode ?? ''))
      dateFormats.add(Number(attributes.numFmtId));
    if (name === 'cellXfs') inCellXfs = true;
    if (name === 'xf' && inCellXfs) {
      if (dateFormats.has(Number(attributes.numFmtId ?? 0))) dateStyles.add(xfIndex);
      xfIndex += 1;
    }
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (localName(tag.name) === 'cellXfs') inCellXfs = false;
  });
  parser.write(xml).close();
  return dateStyles;
}

/** True for custom formats such as dd-mm-yyyy or h:mm, false for 0.00, #,##0, "₹"0 or @. */
export function isDateFormatCode(code: string): boolean {
  const bare = code
    .replace(/"[^"]*"/g, '') // quoted text
    .replace(/\\./g, '') // escaped characters
    .replace(/\[[^\]]*\]/g, ''); // colours, conditions, locales
  return /[dmyhs]/i.test(bare);
}

function cellValue(type: string, style: number, raw: string, workbook: Workbook): string {
  switch (type) {
    case 's':
      return workbook.sharedStrings[Number(raw)] ?? '';
    case 'inlineStr':
    case 'str': // the text result of a formula
      return unescapeOoxml(raw);
    case 'b':
      return raw === '1' ? 'TRUE' : 'FALSE';
    case 'e': // #N/A and friends
      return raw;
    case 'd':
      return raw.endsWith('T00:00:00') || raw.endsWith('T00:00:00Z')
        ? raw.slice(0, 10)
        : raw.replace('T', ' ');
    default: {
      if (raw === '') return '';
      const n = Number(raw);
      if (Number.isNaN(n)) return raw;
      return workbook.dateStyles.has(style) ? excelDateText(n, workbook.date1904) : numberText(n);
    }
  }
}

function numberText(n: number): string {
  // Whole numbers in full, never 9.19812E+11. Phone numbers are well inside the safe range.
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return BigInt(n).toString();
  return String(n);
}

/** An Excel date serial as 2026-10-28, or 2026-10-28 14:05:00 when it has a time. */
export function excelDateText(serial: number, date1904 = false): string {
  // Day 0 is 1899-12-30 (this absorbs Excel's 1900 leap-year bug for every date after Feb 1900).
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const iso = new Date(epoch + Math.round(serial * 86_400_000)).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

/** OOXML writes some characters as _xHHHH_ (a line break is _x000D_). */
function unescapeOoxml(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function localName(name: string) {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Zero-based column of a cell reference: "C7" → 2, "AA3" → 26. Null when there is none. */
function columnIndex(ref: string): number | null {
  const letters = /^[A-Z]+/.exec(ref)?.[0];
  if (!letters) return null;
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

export interface SheetShape {
  columns: string[];
  headerRow: number | null;
  totalRows: number;
  blankRowsSkipped: number;
}

export interface ShapeOptions {
  /** Leave out to detect the header. A sheet row number to use that row. 0: no header row. */
  headerRow?: number;
  maxRows: number;
  batchSize?: number;
}

const HEADER_SEARCH_ROWS = 20;

/**
 * Turns raw rows into a header and data rows, passing data rows to `onBatch` in order.
 * Rules (also in docs/milestones/m4-lists-and-campaign-draft/backend-api.md):
 * blank rows are skipped and counted between the header and the last data row; with no
 * `headerRow`, the header is the first row with two or more filled cells among the first
 * 20 filled rows, and rows above it are titles.
 */
export async function shapeSheet(
  rows: AsyncIterable<SheetRow>,
  options: ShapeOptions,
  onBatch: (batch: SheetRow[]) => Promise<void>,
): Promise<SheetShape> {
  const batchSize = options.batchSize ?? 5000;
  let header: SheetRow | null = null;
  let headerResolved = options.headerRow === 0;
  const lookahead: SheetRow[] = [];

  let width = 0;
  let totalRows = 0;
  let blankRowsSkipped = 0;
  let pendingBlank = 0;
  let lastRowNumber: number | null = null;
  let batch: SheetRow[] = [];

  const addData = async (row: SheetRow) => {
    // Rows missing from an Excel file (never typed in) are blank rows too.
    if (lastRowNumber !== null) pendingBlank += row.rowNumber - lastRowNumber - 1;
    blankRowsSkipped += pendingBlank;
    pendingBlank = 0;
    lastRowNumber = row.rowNumber;

    totalRows += 1;
    if (totalRows > options.maxRows) {
      throw new ListError(
        422,
        'LIST_TOO_LARGE',
        `The list has more than ${options.maxRows} rows. Split it into smaller files.`,
      );
    }
    width = Math.max(width, row.cells.length);
    batch.push(row);
    if (batch.length >= batchSize) {
      await onBatch(batch);
      batch = [];
    }
  };

  const resolveHeaderFromLookahead = async () => {
    // No row had two filled cells: a one-column list whose first filled row is the header.
    const [first, ...rest] = lookahead;
    header = first ?? null;
    headerResolved = true;
    if (header) lastRowNumber = header.rowNumber;
    for (const row of rest) await addData(row);
    lookahead.length = 0;
  };

  for await (const raw of rows) {
    const row = { rowNumber: raw.rowNumber, cells: trimCells(raw.cells) };
    const blank = row.cells.length === 0;

    if (!headerResolved) {
      if (options.headerRow !== undefined) {
        if (row.rowNumber < options.headerRow) continue;
        if (row.rowNumber > options.headerRow || blank) throw headerRowEmpty(options.headerRow);
        header = row;
        headerResolved = true;
        lastRowNumber = row.rowNumber;
        continue;
      }
      if (blank) continue;
      if (row.cells.filter((c) => c !== '').length >= 2) {
        header = row; // filled rows buffered before it were titles
        headerResolved = true;
        lastRowNumber = row.rowNumber;
        lookahead.length = 0;
        continue;
      }
      lookahead.push(row);
      if (lookahead.length >= HEADER_SEARCH_ROWS) await resolveHeaderFromLookahead();
      continue;
    }

    if (blank) {
      if (lastRowNumber !== null) {
        pendingBlank += row.rowNumber - lastRowNumber;
        lastRowNumber = row.rowNumber;
      }
      continue;
    }
    if (lastRowNumber === null && options.headerRow === 0) lastRowNumber = row.rowNumber - 1;
    await addData(row);
  }

  if (!headerResolved) {
    if (options.headerRow !== undefined) throw headerRowEmpty(options.headerRow);
    await resolveHeaderFromLookahead();
  }
  if (batch.length > 0) await onBatch(batch);

  if (totalRows === 0) {
    throw new ListError(422, 'EMPTY_LIST', 'The file has no data rows below the header.');
  }

  const headerCells: string[] = header ? (header as SheetRow).cells : [];
  return {
    columns: columnNames(headerCells, Math.max(width, headerCells.length)),
    headerRow: header ? (header as SheetRow).rowNumber : null,
    totalRows,
    blankRowsSkipped,
  };
}

const headerRowEmpty = (row: number) =>
  new ListError(422, 'HEADER_ROW_EMPTY', `Row ${row} is empty, so it cannot be the header row.`);

/** Trims every cell and drops empty cells at the end, so a blank row has no cells. */
function trimCells(cells: string[]): string[] {
  const out = cells.map((c) => (c ?? '').trim());
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/** Excel's column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Header text per column; blank headers become `Column C`, repeats get ` (2)`, ` (3)`. */
export function columnNames(headerCells: string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, i) => {
    const base = headerCells[i] || `Column ${columnLetter(i)}`;
    let name = base;
    let count = seen.get(name.toLowerCase()) ?? 0;
    while (seen.has(name.toLowerCase())) {
      count += 1;
      name = `${base} (${count})`;
    }
    seen.set(base.toLowerCase(), count);
    seen.set(name.toLowerCase(), 1);
    return name;
  });
}
