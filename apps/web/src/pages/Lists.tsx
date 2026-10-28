import { type FormEvent, useCallback, useEffect, useState } from 'react';
import type {
  ApiError,
  ClientOption,
  CreateListUploadResponse,
  ImportListRequest,
  ListDetail,
  ListSummary,
} from '@reaplift/shared';

type ListsProps = {
  authHeader: Record<string, string>;
};

type SourceType = 'upload' | 'google_sheet';

class RequestFailed extends Error {}

/** Calls the API and turns an error body into a message a person can act on. */
async function api<T>(
  url: string,
  init: RequestInit,
  authHeader: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeader,
      ...init.headers,
    },
  });
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (res.status === 401)
    throw new RequestFailed(
      'Your session has ended (the server may have restarted). Log in again.',
    );
  if (!res.ok)
    throw new RequestFailed(
      (data as ApiError | null)?.message ?? `Request failed (${res.status}).`,
    );
  return data as T;
}

/** PUTs the file to the signed link, reporting progress; fetch() cannot report upload progress. */
function putFile(uploadUrl: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new RequestFailed((JSON.parse(xhr.responseText) as ApiError).message));
      } catch {
        reject(new RequestFailed(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () =>
      reject(new RequestFailed('Upload failed: the server could not be reached.'));
    xhr.send(file);
  });
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function Lists({ authHeader }: ListsProps) {
  const authKey = authHeader.Authorization ?? '';
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [selected, setSelected] = useState<ListDetail | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('upload');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ clients: ClientOption[] }>('/api/clients', {}, { Authorization: authKey })
      .then((data) => {
        setClients(data.clients);
        setClientId((current) => current || data.clients[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, [authKey]);

  const loadLists = useCallback(
    async (forClient: string) => {
      if (!forClient) return;
      const data = await api<{ lists: ListSummary[] }>(
        `/api/lists?clientId=${forClient}`,
        {},
        { Authorization: authKey },
      );
      setLists(data.lists);
    },
    [authKey],
  );

  useEffect(() => {
    setSelected(null);
    loadLists(clientId).catch((err: Error) => setError(err.message));
  }, [clientId, loadLists]);

  const openList = async (id: string) => {
    setError(null);
    try {
      setSelected(await api<ListDetail>(`/api/lists/${id}?clientId=${clientId}`, {}, authHeader));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '').trim();
    const headerRowText = String(formData.get('headerRow') ?? '').trim();
    const file = formData.get('file');
    const sheetUrl = String(formData.get('sheetUrl') ?? '').trim();

    setError(null);
    setSelected(null);
    if (!clientId) return setError('Pick a client first.');
    if (!name) return setError('Give the list a name.');
    if (headerRowText && !/^\d+$/.test(headerRowText))
      return setError('Header row must be a row number, or 0 for none.');

    try {
      let source: ImportListRequest['source'];
      if (sourceType === 'upload') {
        if (!(file instanceof File) || file.size === 0)
          return setError('Choose a .csv or .xlsx file.');
        setBusy('Getting an upload link…');
        const link = await api<CreateListUploadResponse>(
          '/api/lists/uploads',
          {
            method: 'POST',
            body: JSON.stringify({ clientId, fileName: file.name, sizeBytes: file.size }),
          },
          authHeader,
        );
        await putFile(link.uploadUrl, file, (percent) => setBusy(`Uploading… ${percent}%`));
        source = { type: 'upload', uploadId: link.uploadId };
        setBusy('Reading rows…');
      } else {
        if (!sheetUrl) return setError('Paste the Google Sheet link.');
        source = { type: 'google_sheet', url: sheetUrl };
        setBusy('Downloading the sheet and reading rows…');
      }

      const body: ImportListRequest = {
        clientId,
        name,
        source,
        ...(headerRowText ? { headerRow: Number(headerRowText) } : {}),
      };
      const list = await api<ListDetail>(
        '/api/lists/import',
        { method: 'POST', body: JSON.stringify(body) },
        authHeader,
      );
      setSelected(list);
      form.reset();
      await loadLists(clientId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="page-stack">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Audience lists</h2>
            <p className="muted">
              Upload an Excel or CSV file, or read a Google Sheet shared as “Anyone with the link
              can view”. Up to 200,000 rows.
            </p>
          </div>
        </div>

        <form className="form-grid" onSubmit={handleImport}>
          <label>
            <span>Client</span>
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={Boolean(busy)}
            >
              {clients.length === 0 && (
                <option value="">No clients yet: run pnpm seed:dev-clients</option>
              )}
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.status === 'suspended' ? ' (suspended)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>List name</span>
            <input
              name="name"
              type="text"
              maxLength={120}
              placeholder="October leads"
              disabled={Boolean(busy)}
            />
          </label>

          <div className="segmented" role="radiogroup" aria-label="Where the list comes from">
            {(['upload', 'google_sheet'] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={sourceType === type}
                className={sourceType === type ? 'segment active' : 'segment'}
                onClick={() => setSourceType(type)}
                disabled={Boolean(busy)}
              >
                {type === 'upload' ? 'Upload a file' : 'Google Sheet link'}
              </button>
            ))}
          </div>

          {sourceType === 'upload' ? (
            <label>
              <span>File (.xlsx or .csv)</span>
              <input name="file" type="file" accept=".csv,.xlsx" disabled={Boolean(busy)} />
            </label>
          ) : (
            <label>
              <span>Google Sheet link</span>
              <input
                name="sheetUrl"
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
                disabled={Boolean(busy)}
              />
            </label>
          )}

          <label>
            <span>Header row (optional)</span>
            <input
              name="headerRow"
              type="text"
              inputMode="numeric"
              placeholder="Detect automatically"
              disabled={Boolean(busy)}
            />
            <small className="muted">
              Leave blank to detect it. Type a row number if the header was guessed wrong, or 0 if
              the sheet has no header row.
            </small>
          </label>

          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={Boolean(busy) || !clientId}>
              {busy ? 'Working…' : 'Import list'}
            </button>
            {busy && <span className="muted">{busy}</span>}
          </div>
        </form>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {selected && (
        <div className="panel">
          <div className="panel-header">
            <h2>{selected.name}</h2>
            <button type="button" className="link-button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="list-facts">
            <div>
              <span>Rows</span>
              <strong>{selected.totalRows.toLocaleString('en-IN')}</strong>
            </div>
            <div>
              <span>Columns</span>
              <strong>{selected.columns.length}</strong>
            </div>
            <div>
              <span>Header row</span>
              <strong>{selected.headerRow ?? 'None'}</strong>
            </div>
            <div>
              <span>Blank rows skipped</span>
              <strong>{selected.blankRowsSkipped.toLocaleString('en-IN')}</strong>
            </div>
            <div>
              <span>File</span>
              <strong>{selected.fileName}</strong>
            </div>
          </div>
          {selected.headerRow !== null && selected.headerRow > 1 && (
            <p className="muted">
              Rows above row {selected.headerRow} were treated as titles and not imported. If that
              is wrong, import again with the right header row.
            </p>
          )}
          <h3>First {selected.preview.length} rows</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  {selected.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.preview.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="muted">{row.rowNumber}</td>
                    {selected.columns.map((column, index) => (
                      <td key={column}>{row.cells[index] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Numbers are kept exactly as in the file; cleaning and checking them comes in the next
            step (4.2).
          </p>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Lists for this client</h2>
        </div>
        {lists.length === 0 ? (
          <p className="muted">No lists yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Rows</th>
                  <th>Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id}>
                    <td>
                      <strong>{list.name}</strong>
                      <div className="muted">{list.fileName}</div>
                    </td>
                    <td>{list.source === 'upload' ? 'Upload' : 'Google Sheet'}</td>
                    <td>{list.totalRows.toLocaleString('en-IN')}</td>
                    <td>
                      {formatDate(list.createdAt)}
                      <div className="muted">{list.createdBy}</div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => openList(list.id)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
