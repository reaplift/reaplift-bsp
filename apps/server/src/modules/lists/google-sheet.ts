import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { ListError } from './errors.js';

const NOT_PUBLIC_MESSAGE =
  "Google asked for a sign-in, so the sheet is private. Share it as 'Anyone with the link can view' and try again.";

/**
 * The CSV export address for a Google Sheets link such as
 * https://docs.google.com/spreadsheets/d/<id>/edit#gid=123. The tab comes from `gid`, else the first tab.
 */
export function sheetExportUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw invalidUrl();
  }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(\/|$)/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || !match) throw invalidUrl();

  const gid = /(?:^|[#&?])gid=(\d+)/.exec(`${url.search}${url.hash}`)?.[1];
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

const invalidUrl = () =>
  new ListError(
    422,
    'INVALID_SHEET_URL',
    'Paste the link of a Google Sheet, like https://docs.google.com/spreadsheets/d/…/edit.',
  );

export interface SheetDownload {
  body: Readable;
  fileName: string;
}

/** Downloads a Google Sheet tab as CSV. Follows Google's redirect to its file host, nothing else. */
export async function downloadSheetCsv(
  link: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<SheetDownload> {
  let url = sheetExportUrl(link);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop < 5; hop += 1) {
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: 'manual', signal });
    } catch {
      throw fetchFailed('Google Sheets did not answer in time. Try again in a minute.');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      const next = location ? new URL(location, url) : null;
      if (next?.hostname === 'accounts.google.com')
        throw new ListError(422, 'SHEET_NOT_PUBLIC', NOT_PUBLIC_MESSAGE);
      if (
        !next ||
        !(next.hostname === 'docs.google.com' || next.hostname.endsWith('.googleusercontent.com'))
      ) {
        throw fetchFailed('Google Sheets sent the download somewhere unexpected.');
      }
      url = next.toString();
      continue;
    }

    if (res.status === 401 || res.status === 403)
      throw new ListError(422, 'SHEET_NOT_PUBLIC', NOT_PUBLIC_MESSAGE);
    if (res.status === 404) {
      throw new ListError(
        404,
        'SHEET_NOT_FOUND',
        "Google could not find this sheet. Check the link, and that it is shared as 'Anyone with the link can view'.",
      );
    }
    if (!res.ok || !res.body)
      throw fetchFailed(`Google Sheets answered with status ${res.status}. Try again.`);
    // A sign-in page instead of the data comes back as HTML.
    if (!(res.headers.get('content-type') ?? '').includes('text/csv')) {
      throw new ListError(422, 'SHEET_NOT_PUBLIC', NOT_PUBLIC_MESSAGE);
    }

    return {
      body: Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      fileName: fileNameFrom(res.headers.get('content-disposition')) ?? 'google-sheet.csv',
    };
  }
  throw fetchFailed('Google Sheets redirected too many times.');
}

const fetchFailed = (message: string) => new ListError(502, 'SHEET_FETCH_FAILED', message);

/** File name from Content-Disposition; Google sends "<sheet> - <tab>.csv". */
export function fileNameFrom(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // fall through to the plain form
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}
