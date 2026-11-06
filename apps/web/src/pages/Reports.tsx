import { formatPaise, rupeesToPaise } from '@reaplift/shared';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../components/ui';
import { useLoad } from '../hooks/useLoad';

const count = new Intl.NumberFormat('en-IN');
export const indiaMonth = (at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at).slice(0, 7);

/** Count columns, shown with Indian grouping and right-aligned. */
const NUMBER_COLUMNS = new Set([
  'Total Count',
  'Pending',
  'Failed',
  'Blocked',
  'Sent',
  'Delivered',
  'Not Delivered',
  'DR Not Available',
  'Read Count',
]);

function MonthlySummary({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const [month, setMonth] = useState(indiaMonth());
  const report = useLoad(() => api.monthlyReport(clientId, month), [api, clientId, month]);
  const base = `/api/clients/${encodeURIComponent(clientId)}/reports/monthly?month=${month}`;

  return (
    <Panel
      title="Reports"
      hint="Month-wise campaign summary: one row per campaign confirmed in the month, with Dovesoft's column headings. Each campaign is counted by every message's latest status."
      actions={
        <span className="button-row">
          <a className="small-button" href={`${base}&format=csv`} download>
            Download CSV
          </a>
          <a className="small-button" href={`${base}&format=xlsx`} download>
            Download Excel
          </a>
        </span>
      }
    >
      <div className="filter-row">
        <label>
          Month
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>
      <ErrorNote message={report.error} />
      {report.data &&
        (report.data.items.length === 0 ? (
          <p className="empty-state">No campaigns were confirmed in this month.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {report.data.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((row) => (
                  <tr key={String(row['Sr No.'])}>
                    {report.data!.columns.map((c) => {
                      const value = row[c];
                      if (NUMBER_COLUMNS.has(c)) return <td key={c} className="number-cell">{count.format(Number(value))}</td>;
                      if (c === 'Total Unit') {
                        // The download keeps Dovesoft's plain rupees ("1059.94"); on screen it reads like every other amount.
                        const paise = rupeesToPaise(String(value));
                        return <td key={c} className="number-cell">{paise === null ? String(value) : formatPaise(paise)}</td>;
                      }
                      return <td key={c}>{String(value ?? '')}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Panel>
  );
}

function NumberReport({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const campaigns = useLoad(() => api.campaigns(clientId), [api, clientId]);
  // Only a confirmed campaign has messages to report.
  const sent = (campaigns.data?.items ?? []).filter((c) => c.confirmedAt);
  const [chosen, setChosen] = useState('');
  const campaign = sent.find((c) => c.id === chosen) ?? sent[0];
  const base = campaign ? `/api/clients/${encodeURIComponent(clientId)}/campaigns/${campaign.id}/report` : '';

  return (
    <Panel
      title="Per-number report"
      hint="Every number in one campaign with its status, reason and times (dd/mm/yyyy hh:mm:ss, India time), in Dovesoft's columns."
    >
      <ErrorNote message={campaigns.error} />
      {campaigns.data &&
        (sent.length === 0 ? (
          <p className="empty-state">No campaigns have been sent yet.</p>
        ) : (
          <div className="filter-row">
            <label>
              Campaign
              <select value={campaign?.id} onChange={(e) => setChosen(e.target.value)}>
                {sent.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({formatDateTime(c.confirmedAt)})
                  </option>
                ))}
              </select>
            </label>
            <a className="small-button" href={`${base}?format=csv`} download>
              Download CSV
            </a>
            <a className="small-button" href={`${base}?format=xlsx`} download>
              Download Excel
            </a>
          </div>
        ))}
    </Panel>
  );
}

export function Reports() {
  const { clientId = '' } = useParams();
  return (
    <div className="page-stack">
      <MonthlySummary clientId={clientId} />
      <NumberReport clientId={clientId} />
    </div>
  );
}
