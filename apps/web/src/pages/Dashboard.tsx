import { formatPaise, type DashboardView } from '@reaplift/shared';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { StatCard } from '../components/StatCard';
import { ErrorNote, Panel } from '../components/ui';
import { useLoad } from '../hooks/useLoad';

const count = new Intl.NumberFormat('en-IN');

/** "2026-10-31" as "31 Oct", the day on its own (no time zone shift: the server already counted it in India time). */
export function shortDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

const TILES: Array<{ key: keyof DashboardView['tiles']; label: string }> = [
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last15Days', label: 'Last 15 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

function DayChart({ days }: { days: DashboardView['chart'] }) {
  const highest = Math.max(1, ...days.map((d) => d.messages));
  return (
    <>
      <div className="day-chart" aria-hidden="true">
        {days.map((d) => (
          <div key={d.date} className="day-chart-column" title={`${shortDay(d.date)}: ${count.format(d.messages)} messages`}>
            <div className="day-chart-track">
              <div className="day-chart-bar" style={{ height: `${(d.messages * 100) / highest}%` }} />
            </div>
            <span className="day-chart-label">{shortDay(d.date).slice(0, 2)}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">Messages per day, last 15 days</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Messages</th>
              <th>Delivered</th>
              <th>Read</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{shortDay(d.date)}</td>
                <td>{count.format(d.messages)}</td>
                <td>{count.format(d.delivered)}</td>
                <td>{count.format(d.read)}</td>
                <td>{count.format(d.failed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The four tiles, the day-wise chart and the account box (HLD section 4). Figures refresh every 5 minutes. */
export function Dashboard() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const view = useLoad(() => api.dashboard(clientId), [api, clientId]);
  const data = view.data;

  return (
    <div className="page-stack">
      <Panel title="Dashboard" hint="Messages and spend in India time. Spend is what campaigns were charged per message, with GST.">
        <ErrorNote message={view.error} />
        {!data && !view.error && <p>Loading…</p>}
        {data && (
          <div className="stats-grid">
            {TILES.map(({ key, label }) => (
              <StatCard
                key={key}
                label={label}
                value={count.format(data.tiles[key].messages)}
                trend={`${formatPaise(data.tiles[key].spendPaise)} spent`}
              />
            ))}
          </div>
        )}
      </Panel>
      {data && (
        <>

          <Panel title="Day-wise messages" hint="Messages counted on the day they were queued, in India time. Figures refresh every 5 minutes.">
            {data.chart.every((d) => d.messages === 0) ? (
              <p className="empty-state">No campaign activity in the last 15 days.</p>
            ) : (
              <DayChart days={data.chart} />
            )}
          </Panel>

          <Panel title="WhatsApp account">
            {data.accounts.length === 0 ? (
              <p className="empty-state">No WhatsApp number connected yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Name</th>
                      <th>Quality</th>
                      <th>Messaging limit</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.displayPhone}>
                        <td>{a.displayPhone}</td>
                        <td>{a.displayName ?? '—'}</td>
                        <td>{a.qualityRating ?? 'Not reported yet'}</td>
                        <td>{a.messagingLimit ?? 'Not reported yet'}</td>
                        <td>
                          {a.status}
                          {a.pausedReason ? ` (${a.pausedReason})` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
