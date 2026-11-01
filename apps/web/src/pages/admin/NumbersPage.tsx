import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { Breadcrumbs, ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useLoad } from '../../hooks/useLoad';
import { limitName } from './ClientNumber';

/** Every number's limits and what it has used, and the same overall. */
export function NumbersPage() {
  const { api } = useAuth();
  const { data, error } = useLoad(() => api.limitUsage(), [api]);

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Numbers and limits' }]} />
      <Panel
        title="Numbers and limits"
        hint="Speed is messages a second. The daily limits count different customers in a moving 24 hours, not messages, and all message types count together. Each client has its own Meta limit. Customers messaged and left are our own count, which can differ a little from Meta's. Waiting messages go out by themselves as the limit frees up."
      >
        <ErrorNote message={error} />
        {data && (
          <div className="money-tiles">
            <div className="money-tile">
              <small>Numbers</small>
              <strong>{data.overall.numbers}</strong>
            </div>
            <div className="money-tile">
              <small>Paused</small>
              <strong>{data.overall.pausedNumbers}</strong>
            </div>
            <div className="money-tile">
              <small>At their daily limit</small>
              <strong>{data.overall.numbersAtDailyLimit}</strong>
            </div>
            <div className="money-tile">
              <small>Messages waiting</small>
              <strong>{data.overall.waiting.toLocaleString('en-IN')}</strong>
            </div>
            <div className="money-tile">
              <small>Customers messaged, 24 hours</small>
              <strong>{data.overall.usedLast24Hours.toLocaleString('en-IN')}</strong>
            </div>
            <div className="money-tile">
              <small>Sending now, a second</small>
              <strong>{data.overall.sentPerSecLastMinute}</strong>
            </div>
          </div>
        )}
        {data?.items.length === 0 && <p className="empty-state">No numbers connected yet.</p>}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Top speed</th>
                  <th>Meta's daily limit</th>
                  <th>Our daily limit</th>
                  <th>Customers messaged, 24 hours</th>
                  <th>Customers left</th>
                  <th>Messages waiting</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.waAccountId}>
                    <td>
                      <Link to={`/admin/clients/${row.clientId}?tab=number`}>{row.clientName}</Link>
                    </td>
                    <td>{row.displayPhone}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td>{row.sendRatePerSec} messages a second</td>
                    <td>{row.metaLimit ? `${limitName(row.metaLimit)} customers` : limitName(row.metaLimit)}</td>
                    <td>{row.dailySendLimit === null ? 'None' : `${row.dailySendLimit.toLocaleString('en-IN')} customers`}</td>
                    <td>
                      {row.usedLast24Hours.toLocaleString('en-IN')}
                      {row.usedPercent !== null && (
                        <div className={row.usedPercent >= 100 ? 'usage-bar full' : 'usage-bar'} aria-label={`${row.usedPercent}% used`}>
                          <span style={{ width: `${Math.min(row.usedPercent, 100)}%` }} />
                        </div>
                      )}
                    </td>
                    <td>{row.remaining === null ? 'No limit' : row.remaining.toLocaleString('en-IN')}</td>
                    <td>{row.waiting.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
