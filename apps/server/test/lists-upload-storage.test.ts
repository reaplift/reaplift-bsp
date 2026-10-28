import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkUploadSignature,
  signUploadUrl,
  type UploadGrant,
} from '../src/modules/lists/signed-link.js';
import { listFileKey, LocalDiskStorage } from '../src/modules/lists/storage.js';

const CLIENT = '5b0f2c1e-8a4e-4c39-9a51-0d6c1f6e2a10';
const UPLOAD = '0d4b6a52-3c0e-4a8f-b8a5-7a61c2f4e9d1.csv';
const SECRET = 'test-secret';

describe('signed upload links', () => {
  const grant: UploadGrant = {
    clientId: CLIENT,
    uploadId: UPLOAD,
    fileName: 'leads.csv',
    expires: 2_000,
  };
  const sigOf = (url: string) => new URL(url, 'http://x').searchParams.get('sig') ?? undefined;
  const sig = sigOf(signUploadUrl(grant, SECRET));

  it('builds a link to the upload route carrying the grant', () => {
    const url = new URL(signUploadUrl(grant, SECRET), 'http://x');
    expect(url.pathname).toBe(`/api/lists/uploads/${UPLOAD}`);
    expect(url.searchParams.get('clientId')).toBe(CLIENT);
    expect(url.searchParams.get('fileName')).toBe('leads.csv');
    expect(url.searchParams.get('expires')).toBe('2000');
  });

  it('accepts its own signature before expiry', () => {
    expect(checkUploadSignature(grant, sig, SECRET, 1_999)).toBe('ok');
  });

  it('rejects a link after it expires', () => {
    expect(checkUploadSignature(grant, sig, SECRET, 2_001)).toBe('expired');
  });

  it('rejects any change to the client, file, name or expiry, and a wrong secret', () => {
    expect(
      checkUploadSignature(
        { ...grant, clientId: '00000000-0000-0000-0000-000000000000' },
        sig,
        SECRET,
        0,
      ),
    ).toBe('invalid');
    expect(
      checkUploadSignature({ ...grant, uploadId: UPLOAD.replace('csv', 'xlsx') }, sig, SECRET, 0),
    ).toBe('invalid');
    expect(checkUploadSignature({ ...grant, fileName: 'other.csv' }, sig, SECRET, 0)).toBe(
      'invalid',
    );
    expect(checkUploadSignature({ ...grant, expires: 9_999 }, sig, SECRET, 0)).toBe('invalid');
    expect(checkUploadSignature(grant, sig, 'other-secret', 0)).toBe('invalid');
    expect(checkUploadSignature(grant, undefined, SECRET, 0)).toBe('invalid');
    expect(checkUploadSignature(grant, 'short', SECRET, 0)).toBe('invalid');
  });
});

describe('local disk storage', () => {
  let root: string;
  let storage: LocalDiskStorage;
  const key = listFileKey(CLIENT, UPLOAD);

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reaplift-storage-'));
    storage = new LocalDiskStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores a file with its name and reads it back', async () => {
    const stored = await storage.put(
      key,
      Readable.from([Buffer.from('Name\nAmit\n')]),
      100,
      'leads.csv',
    );
    expect(stored).toEqual({ bytes: 10, fileName: 'leads.csv' });
    expect(await storage.stat(key)).toEqual({ bytes: 10, fileName: 'leads.csv' });
    expect(await text(storage.source(key).stream())).toBe('Name\nAmit\n');
  });

  it('reads byte ranges, which Excel files need', async () => {
    await storage.put(key, Readable.from([Buffer.from('0123456789')]), 100, 'leads.csv');
    const source = storage.source(key);
    expect(await source.size()).toBe(10);
    expect(await text(source.stream(2, 3))).toBe('234');
    expect(await text(source.stream(7))).toBe('789');
  });

  it('knows nothing about a key that was never stored', async () => {
    expect(await storage.stat(key)).toBeNull();
  });

  it('refuses to store twice under one key', async () => {
    await storage.put(key, Readable.from([Buffer.from('a')]), 100, 'leads.csv');
    await expect(
      storage.put(key, Readable.from([Buffer.from('b')]), 100, 'leads.csv'),
    ).rejects.toMatchObject({
      code: 'ALREADY_UPLOADED',
      status: 409,
    });
    expect(await text(storage.source(key).stream())).toBe('a');
  });

  it('stops a file over the limit and leaves nothing behind', async () => {
    const body = Readable.from([Buffer.alloc(60), Buffer.alloc(60)]);
    await expect(storage.put(key, body, 100, 'leads.csv')).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      status: 413,
    });
    expect(await storage.stat(key)).toBeNull();
    expect(await readdir(path.join(root, 'lists', CLIENT))).toEqual([]);
  });

  it('only accepts keys this module builds, so a key cannot leave the folder', () => {
    expect(() => listFileKey(CLIENT, '../../etc/passwd')).toThrow();
    expect(() => listFileKey('..', UPLOAD)).toThrow();
    expect(() => storage.source('lists/../../secret.csv')).toThrow();
  });
});
