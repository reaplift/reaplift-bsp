import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb, createPool } from '../src/lib/db.js';
import { migrate } from '../src/migrate/runner.js';
import { signUploadUrl } from '../src/modules/lists/signed-link.js';
import { LocalDiskStorage } from '../src/modules/lists/storage.js';
import { migrationsDir } from '../src/modes/migrate.js';
import { bigCsv, bigWorkbook, messyWorkbook } from './fixtures/sheets.js';
import { resetDb } from './reset-db.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests (run `pnpm db:up`).');

const pool = createPool(url);
const db = createDb(pool);
const SECRET = 'int-test-secret';
const SHEET =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0';

let uploadDir: string;
let clientA: string;
let clientB: string;

/** Fake Google: public sheets answer with CSV, the "private" one sends people to sign in. */
const fakeGoogle = (async (input: string | URL | Request) => {
  const target = String(input);
  if (target.includes('gid=999')) {
    return new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.google.com/ServiceLogin' },
    });
  }
  return new Response('Student Name,Mobile\nAlexandra,9812345678\n\nAndrew,9812345679\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="Class Data - Sheet1.csv"',
    },
  });
}) as typeof fetch;

function makeApp(listMaxRows = 200_000) {
  return buildApp({
    version: 'test',
    checkDb: async () => true,
    lists: {
      db,
      storage: new LocalDiskStorage(uploadDir),
      uploadSigningSecret: SECRET,
      uploadMaxBytes: 50 * 1024 * 1024,
      listMaxRows,
      fetch: fakeGoogle,
    },
  });
}
type App = ReturnType<typeof makeApp>;

async function login(app: App, role: 'super_admin' | 'client_admin' | 'staff') {
  const email = {
    super_admin: 'admin@reaplift.ai',
    client_admin: 'client@reaplift.ai',
    staff: 'staff@reaplift.ai',
  }[role];
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'password123', role },
  });
  return { authorization: `Bearer ${res.json().token as string}` };
}

/** The panel's three steps: ask for a link, send the bytes, import. */
async function uploadAndImport(
  app: App,
  headers: Record<string, string>,
  clientId: string,
  fileName: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const link = await app.inject({
    method: 'POST',
    url: '/api/lists/uploads',
    headers,
    payload: { clientId, fileName, sizeBytes: bytes.length },
  });
  expect(link.statusCode, link.body).toBe(201);
  const { uploadId, uploadUrl } = link.json() as { uploadId: string; uploadUrl: string };

  const put = await app.inject({
    method: 'PUT',
    url: uploadUrl,
    headers: { 'content-type': 'application/octet-stream' },
    payload: bytes,
  });
  expect(put.statusCode, put.body).toBe(200);
  expect(put.json()).toEqual({ uploadId, bytes: bytes.length });

  const imported = await app.inject({
    method: 'POST',
    url: '/api/lists/import',
    headers,
    payload: { clientId, name: fileName, source: { type: 'upload', uploadId }, ...extra },
  });
  return { uploadId, uploadUrl, imported };
}

const count = async (table: 'lists' | 'list_contacts', where = 'true', params: unknown[] = []) =>
  Number((await pool.query(`select count(*) from ${table} where ${where}`, params)).rows[0].count);

beforeAll(async () => {
  await resetDb(pool);
  await migrate(pool, migrationsDir());
  uploadDir = await mkdtemp(path.join(tmpdir(), 'reaplift-lists-'));
  const { rows } = await pool.query<{ id: string }>(
    `insert into clients (name) values ('Client A'), ('Client B') returning id`,
  );
  [clientA, clientB] = [rows[0]!.id, rows[1]!.id];
});

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  await pool.end();
});

describe.sequential('lists API (task 4.1)', () => {
  it('turns away callers who are not logged in, and logins that are not super users', async () => {
    const app = makeApp();
    const body = { clientId: clientA, fileName: 'a.csv', sizeBytes: 10 };
    const anon = await app.inject({ method: 'POST', url: '/api/lists/uploads', payload: body });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ error: 'UNAUTHORIZED' });

    for (const role of ['client_admin', 'staff'] as const) {
      const headers = await login(app, role);
      for (const req of [
        { method: 'POST' as const, url: '/api/lists/uploads', payload: body },
        {
          method: 'POST' as const,
          url: '/api/lists/import',
          payload: { clientId: clientA, name: 'x', source: { type: 'upload', uploadId: 'x' } },
        },
        { method: 'GET' as const, url: `/api/lists?clientId=${clientA}` },
        { method: 'GET' as const, url: '/api/clients' },
      ]) {
        const res = await app.inject({ ...req, headers });
        expect(res.statusCode, `${role} ${req.url}`).toBe(403);
        expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
      }
    }
  });

  it('lists clients from the database for the picker', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/clients',
      headers: await login(app, 'super_admin'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().clients.map((c: { name: string }) => c.name)).toEqual([
      'Client A',
      'Client B',
    ]);
  });

  it('checks the upload request before giving out a link', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const ask = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/lists/uploads', headers, payload });

    expect(
      (await ask({ clientId: clientA, fileName: 'old.xls', sizeBytes: 10 })).json(),
    ).toMatchObject({ error: 'UNSUPPORTED_FILE_TYPE' });
    const tooBig = await ask({ clientId: clientA, fileName: 'a.csv', sizeBytes: 60 * 1024 * 1024 });
    expect(tooBig.statusCode).toBe(413);
    const noClient = await ask({
      clientId: '00000000-0000-4000-8000-000000000000',
      fileName: 'a.csv',
      sizeBytes: 10,
    });
    expect(noClient.statusCode).toBe(404);
    expect(noClient.json()).toMatchObject({ error: 'CLIENT_NOT_FOUND' });
    const bad = await ask({ clientId: 'nope', fileName: 'a.csv', sizeBytes: 10 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'INVALID_REQUEST' });
  });

  it('imports an uploaded CSV with blank rows into lists and list_contacts', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const csv = Buffer.from(
      'Name,Mobile,City\nAmit,9812345678,Pune\n,,\nRiya,09812345679,Delhi\nSam,+91 98123 45680\n',
    );

    const { imported } = await uploadAndImport(app, headers, clientA, 'october.csv', csv);
    expect(imported.statusCode, imported.body).toBe(201);
    const list = imported.json();
    expect(list).toMatchObject({
      clientId: clientA,
      name: 'october.csv',
      source: 'upload',
      fileName: 'october.csv',
      sourceUrl: null,
      columns: ['Name', 'Mobile', 'City'],
      headerRow: 1,
      totalRows: 3,
      blankRowsSkipped: 1,
      sizeBytes: csv.length,
      createdBy: 'admin@reaplift.ai',
    });
    expect(list.preview).toEqual([
      { rowNumber: 2, cells: ['Amit', '9812345678', 'Pune'] },
      { rowNumber: 4, cells: ['Riya', '09812345679', 'Delhi'] },
      { rowNumber: 5, cells: ['Sam', '+91 98123 45680'] },
    ]);

    // Database state: every row belongs to the list's client.
    expect(await count('list_contacts', 'list_id = $1', [list.id])).toBe(3);
    expect(
      await count('list_contacts', 'list_id = $1 and client_id <> $2', [list.id, clientA]),
    ).toBe(0);
  });

  it('imports an Excel file with a merged title, merged header and text-formatted numbers', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const { imported } = await uploadAndImport(
      app,
      headers,
      clientA,
      'Messy Leads.XLSX',
      await messyWorkbook(),
    );

    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json()).toMatchObject({
      columns: ['Name', 'Contact', 'Column C', 'Joined'],
      headerRow: 2,
      totalRows: 3,
      blankRowsSkipped: 1,
      fileName: 'Messy Leads.XLSX',
    });
    expect(imported.json().preview[0]).toEqual({
      rowNumber: 3,
      cells: ['Amit', '09812345678', 'Pune', '2026-10-28'],
    });
    expect(imported.json().preview[1].cells[1]).toBe('919812345679');
  });

  it('makes upload links single use, and refuses altered or expired links', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const { uploadUrl, imported } = await uploadAndImport(
      app,
      headers,
      clientA,
      'once.csv',
      Buffer.from('Mobile\n1\n'),
    );
    expect(imported.statusCode).toBe(201);

    const again = await app.inject({
      method: 'PUT',
      url: uploadUrl,
      payload: Buffer.from('Mobile\n2\n'),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'ALREADY_UPLOADED' });

    const tampered = await app.inject({
      method: 'PUT',
      url: uploadUrl.replace(clientA, clientB),
      payload: Buffer.from('x'),
    });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json()).toMatchObject({ error: 'INVALID_SIGNATURE' });

    const expiredUrl = signUploadUrl(
      {
        clientId: clientA,
        uploadId: '11111111-1111-4111-8111-111111111111.csv',
        fileName: 'late.csv',
        expires: 1_000,
      },
      SECRET,
    );
    const expired = await app.inject({ method: 'PUT', url: expiredUrl, payload: Buffer.from('x') });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toMatchObject({ error: 'LINK_EXPIRED' });
  });

  it('accepts the file whatever Content-Type the browser sends', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    for (const contentType of ['text/csv', 'application/json', undefined]) {
      const link = await app.inject({
        method: 'POST',
        url: '/api/lists/uploads',
        headers,
        payload: { clientId: clientA, fileName: 'ct.csv', sizeBytes: 9 },
      });
      const put = await app.inject({
        method: 'PUT',
        url: link.json().uploadUrl,
        headers: contentType ? { 'content-type': contentType } : {},
        payload: Buffer.from('Mobile\n1\n'),
      });
      expect(put.statusCode, `${contentType}: ${put.body}`).toBe(200);
    }
  });

  it('never imports the same upload twice, even when asked twice at once', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const { uploadId, imported } = await uploadAndImport(
      app,
      headers,
      clientA,
      'twice.csv',
      Buffer.from('Mobile\n1\n2\n'),
    );
    expect(imported.statusCode).toBe(201);

    const importAgain = () =>
      app.inject({
        method: 'POST',
        url: '/api/lists/import',
        headers,
        payload: { clientId: clientA, name: 'twice again', source: { type: 'upload', uploadId } },
      });
    const results = await Promise.all([importAgain(), importAgain()]);
    expect(results.map((r) => r.statusCode)).toEqual([409, 409]);
    expect(results[0]!.json()).toMatchObject({ error: 'ALREADY_IMPORTED' });
    expect(await count('lists', 'file_name = $1', ['twice.csv'])).toBe(1);
  });

  it("keeps clients apart: B cannot import, see or open A's lists", async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const link = await app.inject({
      method: 'POST',
      url: '/api/lists/uploads',
      headers,
      payload: { clientId: clientA, fileName: 'private.csv', sizeBytes: 12 },
    });
    await app.inject({
      method: 'PUT',
      url: link.json().uploadUrl,
      payload: Buffer.from('Mobile\n123\n'),
    });

    const stolen = await app.inject({
      method: 'POST',
      url: '/api/lists/import',
      headers,
      payload: {
        clientId: clientB,
        name: 'stolen',
        source: { type: 'upload', uploadId: link.json().uploadId },
      },
    });
    expect(stolen.statusCode).toBe(404);
    expect(stolen.json()).toMatchObject({ error: 'UPLOAD_NOT_FOUND' });

    const listsOfA = (
      await app.inject({ method: 'GET', url: `/api/lists?clientId=${clientA}`, headers })
    ).json().lists;
    const listsOfB = (
      await app.inject({ method: 'GET', url: `/api/lists?clientId=${clientB}`, headers })
    ).json().lists;
    expect(listsOfA.length).toBeGreaterThan(0);
    expect(listsOfB).toEqual([]);

    const openA = await app.inject({
      method: 'GET',
      url: `/api/lists/${listsOfA[0].id}?clientId=${clientA}`,
      headers,
    });
    expect(openA.statusCode).toBe(200);
    expect(openA.json().preview.length).toBeGreaterThan(0);
    const openAsB = await app.inject({
      method: 'GET',
      url: `/api/lists/${listsOfA[0].id}?clientId=${clientB}`,
      headers,
    });
    expect(openAsB.statusCode).toBe(404);
    expect(openAsB.json()).toMatchObject({ error: 'LIST_NOT_FOUND' });
  });

  it('saves nothing when a file cannot be read or is too long', async () => {
    const before = { lists: await count('lists'), contacts: await count('list_contacts') };

    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const broken = await uploadAndImport(
      app,
      headers,
      clientA,
      'renamed.xlsx',
      Buffer.from('this is not a workbook'),
    );
    expect(broken.imported.statusCode).toBe(422);
    expect(broken.imported.json()).toMatchObject({ error: 'INVALID_FILE' });

    const small = makeApp(5);
    const smallHeaders = await login(small, 'super_admin');
    const long = await uploadAndImport(small, smallHeaders, clientA, 'long.csv', bigCsv(6));
    expect(long.imported.statusCode).toBe(422);
    expect(long.imported.json()).toMatchObject({ error: 'LIST_TOO_LARGE' });

    // The rows written before the limit was hit were rolled back with the list.
    expect({ lists: await count('lists'), contacts: await count('list_contacts') }).toEqual(before);
  });

  it('reads a public Google Sheet and keeps a copy of what it read', async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/lists/import',
      headers,
      payload: {
        clientId: clientB,
        name: 'Class data',
        source: { type: 'google_sheet', url: SHEET },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      clientId: clientB,
      source: 'google_sheet',
      sourceUrl: SHEET,
      fileName: 'Class Data - Sheet1.csv',
      columns: ['Student Name', 'Mobile'],
      totalRows: 2,
      blankRowsSkipped: 1,
    });
    const { rows } = await pool.query('select storage_key from lists where id = $1', [
      res.json().id,
    ]);
    expect(rows[0].storage_key).toMatch(new RegExp(`^lists/${clientB}/[0-9a-f-]{36}\\.csv$`));
  });

  it('explains that a private Google Sheet must be shared, and saves nothing', async () => {
    const before = await count('lists');
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/lists/import',
      headers,
      payload: {
        clientId: clientA,
        name: 'private',
        source: { type: 'google_sheet', url: SHEET.replace('gid=0', 'gid=999') },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: 'SHEET_NOT_PUBLIC',
      message:
        "Google asked for a sign-in, so the sheet is private. Share it as 'Anyone with the link can view' and try again.",
    });
    expect(await count('lists')).toBe(before);
  });

  // Acceptance for 4.1: files up to 200K rows load into lists and list_contacts.
  it('loads a 200,000-row CSV', { timeout: 180_000 }, async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const started = Date.now();
    const { imported } = await uploadAndImport(app, headers, clientA, 'big.csv', bigCsv(200_000));
    const seconds = (Date.now() - started) / 1000;

    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json().totalRows).toBe(200_000);
    expect(await count('list_contacts', 'list_id = $1', [imported.json().id])).toBe(200_000);
    console.log(`200,000-row CSV uploaded and imported in ${seconds.toFixed(1)} s`);
  });

  it('loads a 200,000-row Excel file', { timeout: 300_000 }, async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const workbook = await bigWorkbook(200_000);
    const started = Date.now();
    const { imported } = await uploadAndImport(app, headers, clientA, 'big.xlsx', workbook);
    const seconds = (Date.now() - started) / 1000;

    expect(imported.statusCode, imported.body).toBe(201);
    expect(imported.json().totalRows).toBe(200_000);
    expect(imported.json().preview[0].cells).toEqual(['Person 0', '919800000000', 'Mumbai']);
    expect(await count('list_contacts', 'list_id = $1', [imported.json().id])).toBe(200_000);
    console.log(
      `200,000-row Excel file (${(workbook.length / 1e6).toFixed(1)} MB) uploaded and imported in ${seconds.toFixed(1)} s`,
    );
  });

  it('refuses one row over the 200,000 limit', { timeout: 180_000 }, async () => {
    const app = makeApp();
    const headers = await login(app, 'super_admin');
    const { imported } = await uploadAndImport(
      app,
      headers,
      clientA,
      'too-big.csv',
      bigCsv(200_001),
    );
    expect(imported.statusCode).toBe(422);
    expect(imported.json()).toMatchObject({ error: 'LIST_TOO_LARGE' });
  });
});
