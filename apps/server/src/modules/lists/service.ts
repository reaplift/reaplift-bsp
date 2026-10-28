import { sql, type Kysely } from 'kysely';
import type { ClientOption, ListDetail, ListSummary } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { ListError } from './errors.js';
import { readRows, shapeSheet, type SheetKind, type SheetRow } from './read-sheet.js';
import type { FileStorage } from './storage.js';

const PREVIEW_ROWS = 10;

interface ListRow {
  id: string;
  client_id: string;
  name: string;
  source: 'upload' | 'google_sheet';
  file_name: string;
  source_url: string | null;
  size_bytes: string; // bigint comes back from pg as text
  columns: string[];
  header_row: number | null;
  total_rows: number;
  blank_rows_skipped: number;
  created_by: string;
  created_at: Date;
}

const toSummary = (row: ListRow): ListSummary => ({
  id: row.id,
  clientId: row.client_id,
  name: row.name,
  source: row.source,
  fileName: row.file_name,
  sourceUrl: row.source_url,
  columns: row.columns,
  headerRow: row.header_row,
  totalRows: row.total_rows,
  blankRowsSkipped: row.blank_rows_skipped,
  sizeBytes: Number(row.size_bytes),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

export async function findClient(db: Kysely<Database>, clientId: string) {
  const { rows } = await sql<ClientOption>`
    select id, name, status from clients where id = ${clientId}
  `.execute(db);
  return rows[0] ?? null;
}

export async function listClients(db: Kysely<Database>) {
  const { rows } =
    await sql<ClientOption>`select id, name, status from clients order by name, id`.execute(db);
  return rows;
}

export interface ImportInput {
  clientId: string;
  name: string;
  createdBy: string;
  source: 'upload' | 'google_sheet';
  sourceUrl: string | null;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  headerRow?: number;
}

/**
 * Reads a stored file into a new list in one transaction: the list and all its rows are
 * saved, or nothing is. A storage key can become a list only once.
 */
export async function importList(
  db: Kysely<Database>,
  storage: FileStorage,
  input: ImportInput,
  maxRows: number,
): Promise<ListDetail> {
  const kind: SheetKind = input.storageKey.endsWith('.xlsx') ? 'xlsx' : 'csv';

  const listId = await db.transaction().execute(async (trx) => {
    let inserted;
    try {
      inserted = await sql<{ id: string }>`
        insert into lists (client_id, name, source, file_name, source_url, storage_key, size_bytes,
                           columns, total_rows, created_by)
        values (${input.clientId}, ${input.name}, ${input.source}, ${input.fileName}, ${input.sourceUrl},
                ${input.storageKey}, ${input.sizeBytes}, '[]'::jsonb, 0, ${input.createdBy})
        returning id
      `.execute(trx);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ListError(
          409,
          'ALREADY_IMPORTED',
          'This file has already been imported as a list.',
        );
      }
      throw err;
    }
    const id = inserted.rows[0]!.id;

    const insertBatch = async (batch: SheetRow[]) => {
      // One JSON parameter per batch keeps the statement small whatever the row count.
      const payload = JSON.stringify(batch.map((r) => [r.rowNumber, r.cells]));
      await sql`
        insert into list_contacts (list_id, client_id, row_number, cells)
        select ${id}, ${input.clientId}, (e->>0)::int, e->1
        from jsonb_array_elements(${payload}::jsonb) as e
      `.execute(trx);
    };

    const shape = await shapeSheet(
      readRows(storage.source(input.storageKey), kind),
      { headerRow: input.headerRow, maxRows },
      insertBatch,
    );

    await sql`
      update lists
      set columns = ${JSON.stringify(shape.columns)}::jsonb,
          header_row = ${shape.headerRow},
          total_rows = ${shape.totalRows},
          blank_rows_skipped = ${shape.blankRowsSkipped}
      where id = ${id} and client_id = ${input.clientId}
    `.execute(trx);
    return id;
  });

  return (await getList(db, input.clientId, listId))!;
}

export async function listLists(db: Kysely<Database>, clientId: string): Promise<ListSummary[]> {
  const { rows } = await sql<ListRow>`
    select * from lists where client_id = ${clientId} order by created_at desc, id limit 100
  `.execute(db);
  return rows.map(toSummary);
}

/** One list with its first rows, or null when it does not exist for this client. */
export async function getList(
  db: Kysely<Database>,
  clientId: string,
  listId: string,
): Promise<ListDetail | null> {
  const { rows } = await sql<ListRow>`
    select * from lists where id = ${listId} and client_id = ${clientId}
  `.execute(db);
  const list = rows[0];
  if (!list) return null;

  const preview = await sql<{ row_number: number; cells: string[] }>`
    select row_number, cells from list_contacts
    where list_id = ${listId} and client_id = ${clientId}
    order by row_number
    limit ${PREVIEW_ROWS}
  `.execute(db);

  return {
    ...toSummary(list),
    preview: preview.rows.map((r) => ({ rowNumber: r.row_number, cells: r.cells })),
  };
}
