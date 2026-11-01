import { formatPaise, formatPercent, type AudienceList, type CampaignDetail, type CampaignSummary, type TemplateView, type VariableMap } from '@reaplift/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { errorMessage } from '../api/messages';
import { useAuth } from '../auth/context';
import { Breadcrumbs, ErrorNote, formatDateTime, Panel } from '../components/ui';
import { useAction, useLoad } from '../hooks/useLoad';
import { workspacePath } from '../paths';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const POLL_MS = 5000;
const STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  running: 'Sending',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const INVALID_WORDS: Record<string, string> = {
  empty: 'Empty',
  not_a_number: 'Not a number',
  too_short: 'Too short',
  too_long: 'Too long',
  not_mobile: 'Not a mobile number',
  scientific_notation: 'Spoiled by Excel (like 9.19E+11)',
  wrong_country: 'Wrong country',
};

const count = (value: number | null | undefined) => (value ?? 0).toLocaleString('en-IN');

function blockedWords(reason: string) {
  if (reason === 'opted_out') return 'Opted out';
  if (reason === 'marketing_cap') return 'Reached the marketing limit';
  const repeat = /^repeat_within_(\d+)h$/.exec(reason);
  return repeat ? `Already messaged in the last ${repeat[1]} hours` : reason;
}

function durationWords(seconds: number) {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minutes` : ''}`;
}

function statusClass(status: string) {
  if (status === 'running' || status === 'completed') return 'status-active';
  if (status === 'cancelled' || status === 'paused') return 'status-suspended';
  return 'status-draft';
}

const StatusWord = ({ status }: { status: string }) => (
  <span className={`status-pill ${statusClass(status)}`}>{STATUS_WORDS[status] ?? status}</span>
);

/** A browser may give a CSV the type of Excel or none at all, so the file's ending decides. */
function audienceType(name: string) {
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.xlsx$/i.test(name)) return XLSX_TYPE;
  return null;
}

function NewCampaign({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const page = workspacePath(clientId, 'campaign');
  const templates = useLoad(() => api.templates(clientId), [api, clientId]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const approved = templates.data?.items.filter((template) => template.status === 'APPROVED') ?? [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = file && audienceType(file.name);
    setProblem(null);
    if (!file || !type) return setProblem('Upload an Excel (.xlsx) or CSV file.');
    await action.run(async () => {
      const list = await api.uploadAudience(clientId, new Blob([file], { type }), file.name);
      const made = await api.createCampaign(clientId, {
        name: String(form.get('name')).trim(),
        templateId: String(form.get('templateId')),
        listId: list.id,
      });
      navigate(`${page}?campaign=${made.id}`);
    });
  };

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Push Campaign', to: page }, { label: 'New campaign' }]} />
      <Panel title="New campaign" hint="Nothing is sent or charged until you confirm on the last step. Until then this is a draft you can come back to.">
        <ErrorNote message={templates.error ?? problem ?? action.error} />
        {templates.data && approved.length === 0 && (
          <p className="empty-state">
            A campaign needs an approved template. <Link to={workspacePath(clientId, 'templates')}>See Templates</Link>.
          </p>
        )}
        {approved.length > 0 && (
          <form className="form-grid" onSubmit={submit}>
            <label>
              Campaign name
              <input name="name" required placeholder="Diwali 2026 wave 1" />
            </label>
            <label>
              Template (approved only)
              <select name="templateId" required>
                {approved.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.language}, {template.category.toLowerCase()})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Audience file: Excel (.xlsx) or CSV, up to 20,000 rows and 10 MB
              <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <label className="checkbox-row">
              <input name="optIn" type="checkbox" required /> Every number in this file has opted in to receive messages from this business
            </label>
            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={action.busy}>
                {action.busy ? 'Uploading…' : 'Upload and continue'}
              </button>
            </div>
          </form>
        )}
      </Panel>
    </div>
  );
}

function NumberColumnStep({ clientId, list, onChanged }: { clientId: string; list: AudienceList; onChanged: () => void }) {
  const { api } = useAuth();
  const action = useAction();
  const ready = list.numberColumn !== null;
  return (
    <Panel title="1. Audience" hint="Numbers are cleaned for you: spaces and +91 are handled, and a number that appears twice is sent once and charged once.">
      <p>
        {list.fileName}: {count(list.rowCount)} rows{list.blankRowsSkipped > 0 && `, ${count(list.blankRowsSkipped)} blank rows skipped`}.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {list.columns.map((column, i) => (
                <th key={i}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.preview.map((row, r) => (
              <tr key={r}>
                {list.columns.map((_, c) => (
                  <td key={c}>{row[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="form-note">The first {list.preview.length} rows.</p>
      <div className="filter-row">
        <label>
          Which column has the phone numbers?
          <select
            value={list.numberColumn ?? ''}
            disabled={action.busy}
            onChange={async (e) => {
              const column = Number(e.target.value);
              if (await action.run(() => api.setNumberColumn(clientId, list.id, column))) onChanged();
            }}
          >
            <option value="" disabled>
              Choose a column
            </option>
            {list.columns.map((column, i) => (
              <option key={i} value={i}>
                {column}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorNote message={action.error} />
      {ready && (
        <p>
          <strong>{count(list.validCount)}</strong> valid, <strong>{count(list.invalidCount)}</strong> invalid, <strong>{count(list.duplicateCount)}</strong> duplicates.{' '}
          {(list.invalidCount ?? 0) + (list.duplicateCount ?? 0) > 0 && (
            <a href={`/api/clients/${clientId}/lists/${list.id}/invalid`} download>
              Download these rows with their reasons
            </a>
          )}
        </p>
      )}
    </Panel>
  );
}

type Source = { kind: 'column'; column: number } | { kind: 'text'; text: string };

function VariablesStep({
  template,
  list,
  saved,
  onChange,
}: {
  template: TemplateView;
  list: AudienceList;
  saved: VariableMap;
  onChange: (map: VariableMap | null) => void;
}) {
  const names = Array.from({ length: template.variableCount ?? 0 }, (_, i) => String(i + 1));
  const [sources, setSources] = useState<Record<string, Source | undefined>>(() =>
    Object.fromEntries(
      Object.entries(saved).map(([name, source]) => [
        name,
        'column' in source ? { kind: 'column' as const, column: source.column } : { kind: 'text' as const, text: source.text },
      ]),
    ),
  );

  const update = (name: string, source: Source | undefined) => {
    const next = { ...sources, [name]: source };
    setSources(next);
    const complete = names.every((n) => {
      const s = next[n];
      return s && (s.kind === 'column' || s.text.trim());
    });
    onChange(
      complete
        ? Object.fromEntries(names.map((n) => {
            const s = next[n]!;
            return [n, s.kind === 'column' ? { column: s.column } : { text: s.text }];
          }))
        : null,
    );
  };

  const firstRow = list.preview[0] ?? [];
  const valueOf = (name: string) => {
    const s = sources[name];
    if (!s) return `{{${name}}}`;
    return (s.kind === 'column' ? firstRow[s.column] : s.text) || `{{${name}}}`;
  };
  const body = template.components.find((c) => c.type === 'BODY')?.text ?? '';
  const preview = body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, name: string) => valueOf(name));

  return (
    <Panel title="2. Message" hint="Fill each variable from a column of your file, which changes per person, or with one fixed text for everyone.">
      {names.length === 0 && <p className="form-note">This template has nothing to fill in.</p>}
      {names.map((name) => {
        const source = sources[name];
        return (
          <div className="filter-row" key={name}>
            <label>
              {`Fill {{${name}}} from`}
              <select
                value={source ? (source.kind === 'column' ? String(source.column) : 'text') : ''}
                onChange={(e) =>
                  update(name, e.target.value === 'text' ? { kind: 'text', text: '' } : { kind: 'column', column: Number(e.target.value) })
                }
              >
                <option value="" disabled>
                  Choose
                </option>
                {list.columns.map((column, i) => (
                  <option key={i} value={i}>
                    Column: {column}
                  </option>
                ))}
                <option value="text">Fixed text</option>
              </select>
            </label>
            {source?.kind === 'text' && (
              <label>
                {`Text for {{${name}}}`}
                <input value={source.text} onChange={(e) => update(name, { kind: 'text', text: e.target.value })} />
              </label>
            )}
          </div>
        );
      })}
      <strong>Preview, with the first row</strong>
      <div className="template-preview" aria-label="Preview">
        {preview}
      </div>
    </Panel>
  );
}

function SummaryStep({ summary, clientId, onConfirm, busy, error }: { summary: CampaignSummary; clientId: string; onConfirm: () => void; busy: boolean; error: string | null }) {
  const short = summary.balanceAfterPaise < 0 ? -summary.balanceAfterPaise : 0;
  const reasons = (byReason: Record<string, number>, words: (reason: string) => string) =>
    Object.entries(byReason).map(([reason, n]) => (
      <div key={reason} style={{ display: 'contents' }}>
        <dt className="sub">{words(reason)}</dt>
        <dd className="sub">{count(n)}</dd>
      </div>
    ));
  return (
    <Panel title="3. Summary" hint="Checks run again when you confirm, so a number that opts out now is still caught.">
      <dl className="summary-list">
        <dt>Rows in the file</dt>
        <dd>{count(summary.total)}</dd>
        <dt className="strong">Will send</dt>
        <dd className="strong">{count(summary.willSend)}</dd>
        <dt>Blocked</dt>
        <dd>{count(summary.blocked.total)}</dd>
        {reasons(summary.blocked.byReason, blockedWords)}
        <dt>Invalid (not charged)</dt>
        <dd>{count(summary.invalid.total)}</dd>
        {reasons(summary.invalid.byReason, (r) => INVALID_WORDS[r] ?? r)}
        <dt>Duplicates (not charged)</dt>
        <dd>{count(summary.duplicate)}</dd>
      </dl>
      <dl className="summary-list">
        <dt>Price per message</dt>
        <dd>
          {formatPaise(summary.priceWithGstPaise)} (includes {formatPercent(summary.gstBp)} GST)
        </dd>
        <dt>Messages charged</dt>
        <dd>{count(summary.priceWithGstPaise > 0 ? Math.round(summary.chargePaise / summary.priceWithGstPaise) : 0)}</dd>
        <dt className="strong">Charge now</dt>
        <dd className="strong">{formatPaise(summary.chargePaise)}</dd>
        <dt>Available in wallet</dt>
        <dd>{formatPaise(summary.availablePaise)}</dd>
        <dt>Available after this</dt>
        <dd>{formatPaise(summary.balanceAfterPaise)}</dd>
      </dl>
      <p>
        Expected to finish sending in {durationWords(summary.estimate.seconds)}, around {formatDateTime(summary.estimate.finishesAt)}.
        {summary.estimate.messagesAhead > 0 && ` ${count(summary.estimate.messagesAhead)} messages already waiting go first.`}
      </p>
      <p className="form-note">This is when messages reach Meta, not when phones receive them.</p>
      {summary.estimate.waitsForDailyLimit && <p className="warning-note">Part of this waits for the daily limit to free up, then carries on by itself.</p>}
      {summary.limitWarning && (
        <p className="warning-note" role="status">
          This is more than the daily limit of {count(summary.limitWarning.limit)} customers. The rest wait and send as the limit frees up, or you can split the campaign.
        </p>
      )}
      {short > 0 && (
        <p className="warning-note" role="alert">
          Top up needed: {formatPaise(short)} short. <Link to={workspacePath(clientId, 'wallet')}>See Wallet</Link>.
        </p>
      )}
      <ErrorNote message={error} />
      <div className="form-actions">
        <button type="button" className="primary-button" disabled={busy || short > 0 || summary.willSend + summary.blocked.total === 0} onClick={onConfirm}>
          {busy ? 'Starting…' : `Confirm and charge ${formatPaise(summary.chargePaise)}`}
        </button>
      </div>
    </Panel>
  );
}

function Draft({ clientId, campaign, onStarted }: { clientId: string; campaign: CampaignDetail; onStarted: () => void }) {
  const { api } = useAuth();
  const page = workspacePath(clientId, 'campaign');
  const list = useLoad(() => api.audience(clientId, campaign.listId ?? ''), [api, clientId, campaign.listId]);
  const template = useLoad(() => api.template(clientId, campaign.templateId), [api, clientId, campaign.templateId]);
  // Undefined until the variables are touched; null while one of them is empty.
  const [variables, setVariables] = useState<VariableMap | null | undefined>(undefined);
  const [summary, setSummary] = useState<CampaignSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needed = template.data?.variableCount ?? 0;
  const savedComplete = Array.from({ length: needed }, (_, i) => String(i + 1)).every((name) => campaign.variableMap[name]);
  const map = variables === undefined ? (savedComplete ? campaign.variableMap : null) : variables;
  const columnChosen = list.data?.numberColumn !== null && list.data !== null;

  const seeSummary = async () => {
    setBusy(true);
    setProblem(null);
    setSummary(null);
    try {
      await api.setCampaignVariables(clientId, campaign.id, map ?? {});
      setSummary(await api.campaignSummary(clientId, campaign.id));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setConfirmError(null);
    try {
      await api.confirmCampaign(clientId, campaign.id);
      onStarted();
    } catch (err) {
      const shortPaise = err instanceof ApiError ? (err.body as { shortPaise?: number } | null)?.shortPaise : undefined;
      setConfirmError(shortPaise ? `Top up needed: ${formatPaise(shortPaise)} short. Nothing was charged.` : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Push Campaign', to: page }, { label: campaign.name }]} />
      <ErrorNote message={list.error ?? template.error} />
      {list.data && (
        <NumberColumnStep
          clientId={clientId}
          list={list.data}
          onChanged={() => {
            setSummary(null);
            list.reload();
          }}
        />
      )}
      {list.data && template.data && columnChosen && (
        <VariablesStep
          template={template.data}
          list={list.data}
          saved={campaign.variableMap}
          onChange={(next) => {
            setSummary(null);
            setVariables(next);
          }}
        />
      )}
      {list.data && template.data && columnChosen && (
        <>
          <ErrorNote message={problem} />
          {!summary && (
            <div className="form-actions">
              <button type="button" className="primary-button" disabled={busy || !map} onClick={() => void seeSummary()}>
                See summary
              </button>
            </div>
          )}
        </>
      )}
      {summary && <SummaryStep summary={summary} clientId={clientId} busy={busy} error={confirmError} onConfirm={() => void confirm()} />}
    </div>
  );
}

function Running({ clientId, campaign }: { clientId: string; campaign: CampaignDetail }) {
  const page = workspacePath(clientId, 'campaign');
  const toSend = (campaign.total ?? 0) - (campaign.blocked ?? 0);
  // A message's status moves on, so delivered and read messages were sent too.
  const finished = (campaign.sent ?? 0) + (campaign.delivered ?? 0) + (campaign.read ?? 0) + (campaign.failed ?? 0);
  const percent = toSend > 0 ? Math.min(Math.floor((finished * 100) / toSend), 100) : 100;
  const tiles: [string, number | null][] = [
    ['To send', toSend],
    ['Sent', (campaign.sent ?? 0) + (campaign.delivered ?? 0) + (campaign.read ?? 0)],
    ['Delivered', (campaign.delivered ?? 0) + (campaign.read ?? 0)],
    ['Read', campaign.read],
    ['Failed', campaign.failed],
    ['Blocked', campaign.blocked],
  ];
  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Push Campaign', to: page }, { label: campaign.name }]} />
      <Panel title={campaign.name} actions={<StatusWord status={campaign.status} />}>
        <div className="progress-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Finished so far">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="form-note">{percent}% finished, counting sent and failed messages.</p>
        <div className="money-tiles">
          {tiles.map(([name, value]) => (
            <div className="money-tile" key={name}>
              <small>{name}</small>
              <strong>{count(value)}</strong>
            </div>
          ))}
        </div>
        {campaign.estimate && campaign.estimate.seconds > 0 && (
          <p>
            Expected to finish sending in {durationWords(campaign.estimate.seconds)}, around {formatDateTime(campaign.estimate.finishesAt)}.
          </p>
        )}
      </Panel>
      <Panel title="Money" hint="Charged when the campaign starts. A message that fails at Meta is refunded to the wallet by itself.">
        <dl className="summary-list">
          <dt>Charged</dt>
          <dd>{formatPaise(campaign.chargedPaise)}</dd>
          <dt>Refunded</dt>
          <dd>{formatPaise(campaign.refundedPaise)}</dd>
          <dt className="strong">Net</dt>
          <dd className="strong">{formatPaise(campaign.chargedPaise - campaign.refundedPaise)}</dd>
        </dl>
      </Panel>
      {campaign.failures.length > 0 && (
        <Panel title="Why messages failed">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Messages</th>
                </tr>
              </thead>
              <tbody>
                {campaign.failures.map((failure, i) => (
                  <tr key={i}>
                    <td>{failure.label}</td>
                    <td>{count(failure.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function OneCampaign({ clientId, id }: { clientId: string; id: string }) {
  const { api } = useAuth();
  const { data, error, reload } = useLoad(() => api.campaign(clientId, id), [api, clientId, id]);
  const moving = data?.status === 'running';
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [moving, reload]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <p>Loading…</p>;
  return data.status === 'draft' ? <Draft clientId={clientId} campaign={data} onStarted={reload} /> : <Running clientId={clientId} campaign={data} />;
}

export function PushCampaign() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const selected = params.get('campaign');
  const creating = params.get('new') === '1';
  const page = workspacePath(clientId, 'campaign');
  const campaigns = useLoad(() => api.campaigns(clientId), [api, clientId, selected, creating]);

  if (selected) return <OneCampaign key={selected} clientId={clientId} id={selected} />;
  if (creating) return <NewCampaign clientId={clientId} />;

  return (
    <Panel
      title="Push Campaign"
      hint="Send an approved template to a list of customers. You see exactly who will get it and what it costs before anything is charged."
      actions={
        <Link className="primary-button" to={`${page}?new=1`}>
          New campaign
        </Link>
      }
    >
      <ErrorNote message={campaigns.error} />
      {campaigns.data?.items.length === 0 && <p className="empty-state">No campaigns yet.</p>}
      {campaigns.data && campaigns.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>To send</th>
                <th>Failed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.data.items.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <Link to={`${page}?campaign=${campaign.id}`}>{campaign.name}</Link>
                  </td>
                  <td>
                    <StatusWord status={campaign.status} />
                  </td>
                  <td>{campaign.status === 'draft' ? '' : count((campaign.total ?? 0) - (campaign.blocked ?? 0))}</td>
                  <td>{campaign.status === 'draft' ? '' : count(campaign.failed)}</td>
                  <td>{formatDateTime(campaign.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
