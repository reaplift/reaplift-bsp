import type { AdminCampaign } from '@reaplift/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { Breadcrumbs, ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useLoad } from '../../hooks/useLoad';
import { workspacePath } from '../../paths';
import { StatusWord } from '../PushCampaign';

const STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'];
const STATUS_NAMES: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  running: 'Sending',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const count = (value: number | null | undefined) => (value ?? 0).toLocaleString('en-IN');
const limitText = (value: number | null) => (value === null ? 'No limit' : `${count(value)} customers`);

/** "Why is my campaign not moving?" (M8): what the server finds, in words the super admin can read to the client. */
function Diagnosis({ id, campaign }: { id: string; campaign: AdminCampaign | undefined }) {
  const { api } = useAuth();
  const { data, error, reload } = useLoad(() => api.campaignDiagnosis(id), [api, id]);
  const name = campaign ? `${campaign.name} (${campaign.clientName})` : 'Campaign';

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Campaigns', to: '/admin/campaigns' }, { label: name }]} />
      <ErrorNote message={error} />
      {data && (
        <>
          <Panel
            title={name}
            actions={
              <>
                <StatusWord status={data.status} />{' '}
                <button type="button" className="small-button" onClick={reload}>
                  Check again
                </button>
              </>
            }
          >
            <p className="diagnosis-headline">{data.headline}</p>
            {data.reasons.length > 1 && (
              <ul className="rule-list">
                {data.reasons.slice(1).map((reason) => (
                  <li key={reason.code}>{reason.message}</li>
                ))}
              </ul>
            )}
            {campaign && (
              <p>
                <Link to={`${workspacePath(campaign.clientId, 'campaign')}?campaign=${campaign.id}`}>Open it in the client's workspace</Link>
              </p>
            )}
          </Panel>
          <Panel title="Queue and limits" hint="The number's speed and daily limit are set on the client's WhatsApp number tab. The daily limit is the lower of ours and Meta's.">
            <dl className="summary-list">
              <dt>Messages waiting</dt>
              <dd>{count(data.queue.waiting)}</dd>
              <dt>Being sent now</dt>
              <dd>{count(data.queue.sending)}</dd>
              <dt>Earlier messages on this number</dt>
              <dd>{count(data.queue.aheadOnNumber)}</dd>
              <dt>Speed</dt>
              <dd>{count(data.limits.sendRatePerSec)} a second</dd>
              <dt>Daily limit</dt>
              <dd>{limitText(data.limits.dailyLimit)}</dd>
              <dt>Left today</dt>
              <dd>{data.limits.remainingToday === null ? 'No limit' : count(data.limits.remainingToday)}</dd>
              <dt>Meta's limit</dt>
              <dd>{data.limits.metaLimit ? data.limits.metaLimit.replace('TIER_', '') : 'Not known yet'}</dd>
              <dt>Our limit</dt>
              <dd>{data.limits.dailySetting === null ? 'None, only Meta' : `${count(data.limits.dailySetting)} customers`}</dd>
            </dl>
            {data.estimate && data.estimate.seconds > 0 && <p>Expected to finish around {formatDateTime(data.estimate.finishesAt)}.</p>}
          </Panel>
          {data.failures.length > 0 && (
            <Panel title="Failures by Meta's code">
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Reason</th>
                      <th>Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failures.map((failure, i) => (
                      <tr key={i}>
                        <td>{failure.code ?? ''}</td>
                        <td>{failure.reason ?? ''}</td>
                        <td>{count(failure.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/** Every client's campaigns, to find the one a client is asking about. */
export function CampaignsPage() {
  const { api } = useAuth();
  const [params] = useSearchParams();
  const selected = params.get('campaign');
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState('');
  const clients = useLoad(() => api.adminClients(), [api]);
  const list = useLoad(() => api.adminCampaigns({ clientId: clientId || undefined, status: status || undefined }), [api, clientId, status]);

  if (selected) return <Diagnosis key={selected} id={selected} campaign={list.data?.items.find((c) => c.id === selected)} />;

  return (
    <Panel title="Campaigns" hint="Every client's campaigns, newest first. Open one to see why it is where it is: money, the number, limits, the queue or a stall.">
      <div className="filter-row">
        <label>
          Client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_NAMES[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNote message={list.error ?? clients.error} />
      {list.data?.items.length === 0 && <p className="empty-state">Nothing matches.</p>}
      {list.data && list.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>To send</th>
                <th>Failed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.clientName}</td>
                  <td>
                    <Link to={`/admin/campaigns?campaign=${c.id}`}>{c.name}</Link>
                  </td>
                  <td>
                    <StatusWord status={c.status} />
                  </td>
                  <td>{c.status === 'draft' ? '' : count((c.total ?? 0) - (c.blocked ?? 0))}</td>
                  <td>{c.status === 'draft' ? '' : count(c.failed)}</td>
                  <td>{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
