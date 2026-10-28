import { describe, expect, it } from 'vitest';
import { ListError } from '../src/modules/lists/errors.js';
import {
  bufferSource,
  columnLetter,
  columnNames,
  excelDateText,
  isDateFormatCode,
  readRows,
  shapeSheet,
  type ShapeOptions,
  type SheetKind,
  type SheetRow,
} from '../src/modules/lists/read-sheet.js';
import {
  cellTypesWorkbook,
  messyWorkbook,
  reorderedTabsWorkbook,
  worksheetsBeforeWorkbook,
} from './fixtures/sheets.js';

async function shape(data: string | Buffer, kind: SheetKind, options: Partial<ShapeOptions> = {}) {
  const rows: SheetRow[] = [];
  const batches: number[] = [];
  const result = await shapeSheet(
    readRows(bufferSource(Buffer.from(data)), kind),
    { maxRows: 1000, ...options },
    async (batch) => {
      batches.push(batch.length);
      rows.push(...batch);
    },
  );
  return { ...result, rows, batches };
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ListError);
    return err as ListError;
  }
  throw new Error('expected a ListError');
}

describe('Excel dates', () => {
  it('turns date serials into dates, with the time only when there is one', () => {
    expect(excelDateText(46323)).toBe('2026-10-28');
    expect(excelDateText(46323.5868055556)).toBe('2026-10-28 14:05:00');
    expect(excelDateText(61)).toBe('1900-03-01');
    expect(excelDateText(44861, true)).toBe('2026-10-28'); // 1904 date system (old Mac workbooks)
  });

  it('tells date formats from number formats', () => {
    for (const code of [
      'dd-mm-yyyy',
      'd/m/yy',
      'h:mm AM/PM',
      'mmm yyyy',
      '[$-409]d-mmm-yy;@',
      'yyyy-mm-dd hh:mm:ss',
    ]) {
      expect(isDateFormatCode(code), code).toBe(true);
    }
    for (const code of [
      'General',
      '0',
      '0.00',
      '#,##0',
      '"₹"#,##0.00',
      '@',
      '[Red]0.00',
      '0" days"',
      '_(* #,##0_)',
    ]) {
      expect(isDateFormatCode(code), code).toBe(false);
    }
  });
});

describe('column names', () => {
  it('uses Excel letters', () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ]);
  });

  it('names blank headers by letter and numbers repeats, ignoring letter case', () => {
    expect(columnNames(['Name', '', 'Mobile', 'name', 'Name', 'Mobile'], 8)).toEqual([
      'Name',
      'Column B',
      'Mobile',
      'name (2)',
      'Name (3)',
      'Mobile (2)',
      'Column G',
      'Column H',
    ]);
  });
});

describe('reading a CSV', () => {
  it('skips blank rows, counts the ones inside the data and keeps row numbers', async () => {
    const csv =
      '﻿Name,Mobile,City\r\nAmit,9812345678,Pune\r\n,,\r\n   ,\r\nRiya,09812345679,Delhi\r\nSam,+91 98123 45680\r\n\r\n,,\r\n';
    const r = await shape(csv, 'csv');

    expect(r.columns).toEqual(['Name', 'Mobile', 'City']); // BOM removed from "Name"
    expect(r.headerRow).toBe(1);
    expect(r.totalRows).toBe(3);
    expect(r.blankRowsSkipped).toBe(2); // rows 3 and 4; trailing blanks are not counted
    expect(r.rows).toEqual([
      { rowNumber: 2, cells: ['Amit', '9812345678', 'Pune'] },
      { rowNumber: 5, cells: ['Riya', '09812345679', 'Delhi'] },
      { rowNumber: 6, cells: ['Sam', '+91 98123 45680'] },
    ]);
  });

  it('treats title rows above the header as titles', async () => {
    const r = await shape('October leads,,\n\nName,Mobile\nAmit,9812345678\n', 'csv');
    expect(r.headerRow).toBe(3);
    expect(r.columns).toEqual(['Name', 'Mobile']);
    expect(r.rows).toEqual([{ rowNumber: 4, cells: ['Amit', '9812345678'] }]);
  });

  it('reads a one-column list with its first row as the header', async () => {
    const r = await shape('Mobile\n9812345678\n\n9812345679\n', 'csv');
    expect(r.headerRow).toBe(1);
    expect(r.columns).toEqual(['Mobile']);
    expect(r.totalRows).toBe(2);
    expect(r.blankRowsSkipped).toBe(1);
  });

  it('reads every row as data when headerRow is 0', async () => {
    const r = await shape('\n9812345678,Amit\n9812345679,Riya\n', 'csv', { headerRow: 0 });
    expect(r.headerRow).toBeNull();
    expect(r.columns).toEqual(['Column A', 'Column B']);
    expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3]);
    expect(r.blankRowsSkipped).toBe(0);
  });

  it('uses the header row it is told to, ignoring rows above it', async () => {
    const r = await shape(
      'Report,for,October\nignore,me,too\nName,Mobile\nAmit,9812345678\n',
      'csv',
      {
        headerRow: 3,
      },
    );
    expect(r.columns).toEqual(['Name', 'Mobile']);
    expect(r.rows).toEqual([{ rowNumber: 4, cells: ['Amit', '9812345678'] }]);
  });

  it('names data that runs past the header by column letter', async () => {
    const r = await shape('Name,Mobile\nAmit,9812345678,extra,more\n', 'csv');
    expect(r.columns).toEqual(['Name', 'Mobile', 'Column C', 'Column D']);
  });

  it('passes rows on in batches, in order', async () => {
    const r = await shape('Mobile\n1\n2\n3\n4\n5\n', 'csv', { batchSize: 2 });
    expect(r.batches).toEqual([2, 2, 1]);
    expect(r.rows.map((x) => x.cells[0])).toEqual(['1', '2', '3', '4', '5']);
  });

  it('rejects a header row that is empty', async () => {
    const err = await failure(shape('Name,Mobile\n\nAmit,1\n', 'csv', { headerRow: 2 }));
    expect(err.code).toBe('HEADER_ROW_EMPTY');
  });

  it('rejects a file with no data rows', async () => {
    expect((await failure(shape('Name,Mobile\n\n,,\n', 'csv'))).code).toBe('EMPTY_LIST');
    expect((await failure(shape('', 'csv'))).code).toBe('EMPTY_LIST');
  });

  it('rejects more rows than allowed', async () => {
    const err = await failure(shape('Mobile\n1\n2\n3\n', 'csv', { maxRows: 2 }));
    expect(err.code).toBe('LIST_TOO_LARGE');
    expect(err.status).toBe(422);
  });

  it('reports a broken CSV as an invalid file', async () => {
    const err = await failure(shape('Name,Mobile\n"Amit,9812345678\n', 'csv'));
    expect(err.code).toBe('INVALID_FILE');
  });
});

describe('reading an Excel workbook', () => {
  it('handles a merged title, a merged header, blank rows, text numbers, dates and formulas', async () => {
    const r = await shape(await messyWorkbook(), 'xlsx');

    expect(r.headerRow).toBe(2);
    expect(r.columns).toEqual(['Name', 'Contact', 'Column C', 'Joined']);
    expect(r.totalRows).toBe(3);
    expect(r.blankRowsSkipped).toBe(1);
    expect(r.rows).toEqual([
      { rowNumber: 3, cells: ['Amit', '09812345678', 'Pune', '2026-10-28'] },
      { rowNumber: 5, cells: ['Riya', '919812345679', 'DELHI'] },
      { rowNumber: 6, cells: ['Sam', '+91 98123 45680'] },
    ]);
  });

  it('reads every kind of cell as the text a person sees', async () => {
    const r = await shape(await cellTypesWorkbook(), 'xlsx');
    expect(r.rows[0]!.cells).toEqual([
      '919812345678', // whole number written in full
      '12.5',
      'TRUE',
      '#N/A',
      '919812345678', // formula: its calculated result
      'Click here', // hyperlink: its text
      '2026-10-28 14:05:00', // custom date-and-time format
      'Line 1\nLine 2', // XML turns the written \r\n into \n, as Excel shows it
      'नमस्ते',
    ]);
  });

  it('reads the same workbook the same way every time', async () => {
    // exceljs's stream reader lost shared strings or whole sheets in most reads of small files.
    const workbook = await messyWorkbook();
    for (let i = 0; i < 50; i += 1) {
      const r = await shape(workbook, 'xlsx');
      expect(r.columns).toEqual(['Name', 'Contact', 'Column C', 'Joined']);
      expect(r.totalRows).toBe(3);
    }
  });

  it('reads a workbook whose zip holds the worksheets before xl/workbook.xml', async () => {
    const repacked = await worksheetsBeforeWorkbook(await messyWorkbook());
    const r = await shape(repacked, 'xlsx');
    expect(r.columns).toEqual(['Name', 'Contact', 'Column C', 'Joined']);
    expect(r.rows.map((x) => x.cells[0])).toEqual(['Amit', 'Riya', 'Sam']);

    const tabs = await shape(await worksheetsBeforeWorkbook(await reorderedTabsWorkbook()), 'xlsx');
    expect(tabs.rows).toEqual([{ rowNumber: 2, cells: ['Current person', '911'] }]);
  });

  it('reads the first tab as shown in Excel, not the first file in the workbook', async () => {
    const r = await shape(await reorderedTabsWorkbook(), 'xlsx');
    expect(r.rows).toEqual([{ rowNumber: 2, cells: ['Current person', '911'] }]);
  });

  it('skips a hidden first tab', async () => {
    const r = await shape(await reorderedTabsWorkbook(true), 'xlsx');
    expect(r.rows).toEqual([{ rowNumber: 2, cells: ['Old person', '900'] }]);
  });

  it('reports a file that is not a workbook as an invalid file', async () => {
    const err = await failure(shape('Name,Mobile\nAmit,1\n', 'xlsx'));
    expect(err.code).toBe('INVALID_FILE');
  });
});
