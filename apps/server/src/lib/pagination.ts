export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Reads the list convention: `limit` (default 50, most 500) and `cursor`, the last ID of the previous page. */
export function readPage(query: unknown): { limit: number; cursor: number | null } {
  const { limit, cursor } = (query ?? {}) as { limit?: string; cursor?: string };
  const asked = Number(limit);
  const after = Number(cursor);
  return {
    limit: Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT,
    cursor: cursor !== undefined && Number.isSafeInteger(after) && after > 0 ? after : null,
  };
}

/** Takes rows read with `limit + 1`, and returns the page and where the next one starts. */
export function toPage<T extends { id: number }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? String(items.at(-1)!.id) : null };
}
