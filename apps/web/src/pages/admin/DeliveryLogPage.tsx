import { useState } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel, StatusPill } from '../../components/ui';
import { useLoad } from '../../hooks/useLoad';

export function DeliveryLogPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState('');
  const { data, error } = useLoad(() => api.deliveryLog(status || undefined), [api, status]);

  return (
    <Panel
      title="Delivery log"
      hint="Every email and panel notification the system created, and whether it went out. Use it to answer questions like why did this person not get their email. Pending means waiting to send; Failed shows the error."
    >
      <div className="filter-row">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="read">Read</option>
          </select>
        </label>
      </div>
      <ErrorNote message={error} />
      {data?.items.length === 0 && <p className="empty-state">Nothing matches.</p>}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>To</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.event}</td>
                  <td>{row.email}</td>
                  <td>{row.channel}</td>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td>{row.attempts}</td>
                  <td>{row.lastError}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
