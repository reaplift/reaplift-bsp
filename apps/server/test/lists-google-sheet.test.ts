import { text } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { ListError } from '../src/modules/lists/errors.js';
import {
  downloadSheetCsv,
  fileNameFrom,
  sheetExportUrl,
} from '../src/modules/lists/google-sheet.js';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const VIEW_LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing#gid=42`;

/** A fake Google: maps each requested URL prefix to the response it gives. */
function fakeFetch(routes: Array<[string, () => Response]>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new TypeError(`fetch failed: ${url}`);
    return route[1]();
  }) as typeof fetch;
  return { impl, calls };
}

const redirect = (location: string) => () =>
  new Response(null, { status: 307, headers: { location } });

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ListError);
    return err as ListError;
  }
  throw new Error('expected a ListError');
}

describe('sheetExportUrl', () => {
  it('turns view and edit links into the CSV export address, keeping the tab', () => {
    expect(sheetExportUrl(VIEW_LINK)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`,
    );
    expect(sheetExportUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7`)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=7`,
    );
    expect(sheetExportUrl(` https://docs.google.com/spreadsheets/d/${ID} `)).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`,
    );
  });

  it('rejects links that are not Google Sheets', () => {
    for (const link of [
      'not a link',
      `http://docs.google.com/spreadsheets/d/${ID}/edit`,
      `https://docs.google.com/document/d/${ID}/edit`,
      `https://evil.example.com/spreadsheets/d/${ID}/edit`,
      'https://docs.google.com/spreadsheets/d/short/edit',
    ]) {
      expect(() => sheetExportUrl(link), link).toThrow(
        expect.objectContaining({ code: 'INVALID_SHEET_URL' }),
      );
    }
  });
});

describe('downloadSheetCsv', () => {
  it("follows Google's redirect to its file host and returns the CSV", async () => {
    const { impl, calls } = fakeFetch([
      [
        `https://docs.google.com/spreadsheets/d/${ID}/export`,
        redirect('https://doc-08-4o-sheets.googleusercontent.com/export/abc?format=csv'),
      ],
      [
        'https://doc-08-4o-sheets.googleusercontent.com/',
        () =>
          new Response('Name,Mobile\nAmit,9812345678\n', {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="Leads - Sheet1.csv"; filename*=UTF-8''Leads%20-%20Sheet1.csv`,
            },
          }),
      ],
    ]);

    const sheet = await downloadSheetCsv(VIEW_LINK, impl);
    expect(await text(sheet.body)).toBe('Name,Mobile\nAmit,9812345678\n');
    expect(sheet.fileName).toBe('Leads - Sheet1.csv');
    expect(calls).toHaveLength(2);
  });

  it('says clearly that a private sheet must be shared', async () => {
    const { impl } = fakeFetch([
      [
        'https://docs.google.com/',
        redirect('https://accounts.google.com/ServiceLogin?continue=https://docs.google.com/'),
      ],
    ]);
    const err = await failure(downloadSheetCsv(VIEW_LINK, impl));
    expect(err.code).toBe('SHEET_NOT_PUBLIC');
    expect(err.status).toBe(422);
    expect(err.message).toContain('Anyone with the link can view');
  });

  it('treats 401, 403 and a sign-in page as private', async () => {
    for (const res of [
      () => new Response('', { status: 401 }),
      () => new Response('', { status: 403 }),
      () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      const { impl } = fakeFetch([['https://docs.google.com/', res]]);
      expect((await failure(downloadSheetCsv(VIEW_LINK, impl))).code).toBe('SHEET_NOT_PUBLIC');
    }
  });

  it('reports a missing sheet', async () => {
    const { impl } = fakeFetch([
      ['https://docs.google.com/', () => new Response('', { status: 404 })],
    ]);
    const err = await failure(downloadSheetCsv(VIEW_LINK, impl));
    expect(err.code).toBe('SHEET_NOT_FOUND');
    expect(err.status).toBe(404);
  });

  it('reports Google being down or unreachable', async () => {
    const down = fakeFetch([['https://docs.google.com/', () => new Response('', { status: 500 })]]);
    expect((await failure(downloadSheetCsv(VIEW_LINK, down.impl))).code).toBe('SHEET_FETCH_FAILED');

    const offline = fakeFetch([]);
    const err = await failure(downloadSheetCsv(VIEW_LINK, offline.impl));
    expect(err.code).toBe('SHEET_FETCH_FAILED');
    expect(err.status).toBe(502);
  });

  it('never follows a redirect away from Google', async () => {
    const { impl, calls } = fakeFetch([
      ['https://docs.google.com/', redirect('https://attacker.example.com/data.csv')],
    ]);
    expect((await failure(downloadSheetCsv(VIEW_LINK, impl))).code).toBe('SHEET_FETCH_FAILED');
    expect(calls).toHaveLength(1);
  });
});

describe('fileNameFrom', () => {
  it('prefers the UTF-8 name and falls back to the plain one', () => {
    expect(fileNameFrom(`attachment; filename="a.csv"; filename*=UTF-8''L%C3%A9ads.csv`)).toBe(
      'Léads.csv',
    );
    expect(fileNameFrom('attachment; filename="Leads.csv"')).toBe('Leads.csv');
    expect(fileNameFrom(null)).toBeNull();
  });
});
