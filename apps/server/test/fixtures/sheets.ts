import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * A Dovesoft-style workbook: a merged title banner, a merged header cell, a blank row,
 * text-formatted numbers with a leading zero, a number typed as a number, a date, a
 * formula and rich text. A second sheet must be ignored.
 */
export async function messyWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');

  ws.getCell('A1').value = 'October leads export';
  ws.mergeCells('A1:D1');

  ws.getCell('A2').value = 'Name';
  ws.getCell('B2').value = 'Contact';
  ws.mergeCells('B2:C2'); // header merged across two columns
  ws.getCell('D2').value = 'Joined';

  ws.getCell('A3').value = 'Amit';
  ws.getCell('B3').value = '09812345678';
  ws.getCell('B3').numFmt = '@'; // text-formatted: keeps the leading zero
  ws.getCell('C3').value = 'Pune';
  ws.getCell('D3').value = new Date(Date.UTC(2026, 9, 28));
  ws.getCell('D3').numFmt = 'dd-mm-yyyy';

  // Row 4 is left blank.

  ws.getCell('A5').value = { richText: [{ text: 'Ri' }, { font: { bold: true }, text: 'ya' }] };
  ws.getCell('B5').value = 919812345679; // typed as a number
  ws.getCell('C5').value = { formula: 'UPPER("delhi")', result: 'DELHI' };

  ws.getCell('A6').value = '  Sam  ';
  ws.getCell('B6').value = '+91 98123 45680';

  ws.getCell('A7').value = ''; // trailing rows that are empty
  ws.getCell('A8').value = '   ';

  const other = wb.addWorksheet('Notes');
  other.getCell('A1').value = 'must not be read';
  other.getCell('B1').value = 'ever';

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** One data row holding every kind of cell under a one-line header. */
export async function cellTypesWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Types');
  ws.addRow(['Number', 'Decimal', 'Bool', 'Error', 'Formula', 'Link', 'When', 'Lines', 'Hindi']);
  const row = ws.addRow([
    919812345678,
    12.5,
    true,
    { error: '#N/A' },
    { formula: 'A2*1', result: 919812345678 },
    { text: 'Click here', hyperlink: 'https://reaplift.com' },
    new Date(Date.UTC(2026, 9, 28, 14, 5, 0)),
    'Line 1\r\nLine 2',
    'नमस्ते',
  ]);
  row.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Three tabs whose order differs from their file names: the tab shown first is the second one
 * created (xl/worksheets/sheet2.xml). With `hideFirst`, that first tab is hidden.
 */
export async function reorderedTabsWorkbook(hideFirst = false): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const old = wb.addWorksheet('Old list'); // sheet1.xml
  const current = wb.addWorksheet('Current list'); // sheet2.xml
  const extra = wb.addWorksheet('Extra'); // sheet3.xml
  old.addRows([
    ['Name', 'Mobile'],
    ['Old person', '900'],
  ]);
  current.addRows([
    ['Name', 'Mobile'],
    ['Current person', '911'],
  ]);
  extra.addRows([
    ['Name', 'Mobile'],
    ['Extra person', '922'],
  ]);
  // orderNo sets the tab order exceljs writes to workbook.xml; it is missing from exceljs's types.
  const setTabOrder = (sheet: ExcelJS.Worksheet, orderNo: number) =>
    Object.assign(sheet, { orderNo });
  setTabOrder(current, 0);
  setTabOrder(old, 1);
  setTabOrder(extra, 2);
  if (hideFirst) current.state = 'hidden';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Re-packs a workbook so every worksheet comes before xl/workbook.xml in the zip, with shared
 * strings and relationships first: the order that crashed exceljs's streaming reader.
 */
export async function worksheetsBeforeWorkbook(xlsx: Buffer): Promise<Buffer> {
  const source = await JSZip.loadAsync(xlsx);
  const names = Object.keys(source.files).filter((n) => !source.files[n]!.dir);
  const rank = (n: string) =>
    n === 'xl/sharedStrings.xml' || n.endsWith('.rels')
      ? 0
      : n.startsWith('xl/worksheets/')
        ? 1
        : n === 'xl/workbook.xml'
          ? 3
          : 2;
  const out = new JSZip();
  for (const name of [...names].sort((a, b) => rank(a) - rank(b))) {
    out.file(name, await source.files[name]!.async('nodebuffer'));
  }
  const repacked = await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const order = Object.keys((await JSZip.loadAsync(repacked)).files);
  if (
    order.indexOf('xl/workbook.xml') < order.findIndex((n) => n.startsWith('xl/worksheets/sheet'))
  ) {
    throw new Error('fixture did not put the worksheets first');
  }
  return repacked;
}

/** A workbook with `rows` data rows under a Name / Mobile / City header. */
export async function bigWorkbook(rows: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('List');
  ws.addRow(['Name', 'Mobile', 'City']);
  for (let i = 0; i < rows; i += 1) ws.addRow([`Person ${i}`, 919800000000 + i, 'Mumbai']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A CSV with `rows` data rows under a Name / Mobile / City / Amount / Date header. */
export function bigCsv(rows: number): Buffer {
  const lines = ['Name,Mobile,City,Amount,Date'];
  for (let i = 0; i < rows; i += 1)
    lines.push(`Person ${i},${919800000000 + i},Mumbai,${i % 1000},2026-10-28`);
  return Buffer.from(`${lines.join('\r\n')}\r\n`);
}
