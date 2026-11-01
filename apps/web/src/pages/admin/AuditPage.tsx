import type { AuditRow } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

type Filter = { clientId?: string; userId?: string; action?: string; from?: string; to?: string };

/** The dates are days in India time, so "to" takes in that whole day. */
const dayStart = (day: string) => `${day}T00:00:00+05:30`;
const dayEnd = (day: string) => `${day}T23:59:59+05:30`;

export function AuditPageView() {
  const { api } = useAuth();
  const [filter, setFilter] = useState<Filter>({});
  const [more, setMore] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const clients = useLoad(() => api.adminClients(), [api]);
  const users = useLoad(() => api.adminUsers(), [api]);
  const loadMore = useAction();
  const page = useLoad(async () => {
    const body = await api.audit(filter);
    setMore([]);
    setCursor(body.nextCursor);
    return body;
  }, [api, filter]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '') || undefined;
    const from = value('from');
    const to = value('to');
    setFilter({
      clientId: value('clientId'),
      userId: value('userId'),
      action: value('action'),
      from: from && dayStart(from),
      to: to && dayEnd(to),
    });
  };

  const rows = [...(page.data?.items ?? []), ...more];
  const clientName = (id: string | null) => clients.data?.items.find((c) => c.id === id)?.name ?? '';

  return (
    <Panel
      title="Audit log"
      hint="Who changed what, and when. Every change an admin makes is recorded here with its before and after values. Use it to answer questions like who suspended this client."
    >
      <form className="filter-row" onSubmit={submit}>
        <label>
          Client
          <select name="clientId" defaultValue="">
            <option value="">All</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Who
          <select name="userId" defaultValue="">
            <option value="">Anyone</option>
            {users.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <input name="action" placeholder="client.suspended" />
        </label>
        <label>
          From
          <input name="from" type="date" />
        </label>
        <label>
          To
          <input name="to" type="date" />
        </label>
        <button type="submit" className="primary-button">
          Filter
        </button>
      </form>
      <ErrorNote message={page.error ?? loadMore.error} />
      {page.data && rows.length === 0 && <p className="empty-state">Nothing matches.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Client</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.userName}</td>
                  <td>{row.action}</td>
                  <td>{clientName(row.clientId)}</td>
                  <td className="audit-details">{JSON.stringify(row.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <p>
          <button
            type="button"
            className="small-button"
            disabled={loadMore.busy}
            onClick={() =>
              void loadMore.run(async () => {
                const body = await api.audit({ ...filter, cursor });
                setMore((rows) => [...rows, ...body.items]);
                setCursor(body.nextCursor);
              })
            }
          >
            Show more
          </button>
        </p>
      )}
    </Panel>
  );
}
