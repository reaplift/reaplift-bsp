import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ListError } from './errors.js';
import type { FileSource } from './read-sheet.js';

export interface StoredFile {
  bytes: number;
  fileName: string;
}

/**
 * Where uploaded files live. Local disk for now; OCI Object Storage (S3-compatible, with
 * the file name as object metadata) replaces this class later without changing the routes.
 */
export interface FileStorage {
  /** Stores the stream under `key`. Fails if the key exists or more than `maxBytes` arrive. */
  put(key: string, body: Readable, maxBytes: number, fileName: string): Promise<StoredFile>;
  /** The stored file's details, or null when nothing (or only part of a file) is stored. */
  stat(key: string): Promise<StoredFile | null>;
  /** Reads the file whole or by byte ranges (Object Storage serves ranges too). */
  source(key: string): FileSource;
}

// Keys are built by this module only: lists/<client uuid>/<uuid>.<ext>. Anything else is
// refused, so a key can never point outside the storage directory.
const KEY_PATTERN = /^lists\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(csv|xlsx)$/;

export function listFileKey(clientId: string, uploadId: string) {
  const key = `lists/${clientId}/${uploadId}`;
  if (!KEY_PATTERN.test(key)) throw new Error(`invalid storage key: ${key}`);
  return key;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error(`invalid storage key: ${key}`);
    return path.join(this.root, ...key.split('/'));
  }

  async put(key: string, body: Readable, maxBytes: number, fileName: string) {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });

    let bytes = 0;
    const limit = async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          throw new ListError(
            413,
            'FILE_TOO_LARGE',
            `The file is larger than the ${maxBytes}-byte limit.`,
          );
        }
        yield chunk;
      }
    };

    // 'wx' fails when the file exists, which makes each key single use.
    const out = createWriteStream(file, { flags: 'wx' });
    try {
      await pipeline(body, limit, out);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ListError(409, 'ALREADY_UPLOADED', 'A file was already uploaded with this link.');
      }
      // The file is opened asynchronously: removing it before the stream has closed can lose the
      // race and leave a partial file that blocks the link. (Not once(): it rejects on the 'error'
      // the failed pipeline emits, which would skip the removal.)
      if (!out.closed) await new Promise<void>((resolve) => out.once('close', () => resolve()));
      await rm(file, { force: true });
      throw err;
    }
    // Written last: a file without its details is an unfinished upload and stat() ignores it.
    const stored: StoredFile = { bytes, fileName };
    await writeFile(`${file}.json`, JSON.stringify(stored));
    return stored;
  }

  async stat(key: string) {
    try {
      return JSON.parse(await readFile(`${this.pathFor(key)}.json`, 'utf8')) as StoredFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  source(key: string): FileSource {
    const file = this.pathFor(key);
    return {
      size: async () => (await stat(file)).size,
      stream: (offset = 0, length) =>
        createReadStream(file, {
          start: offset,
          end: length === undefined ? undefined : offset + length - 1,
        }),
    };
  }
}
