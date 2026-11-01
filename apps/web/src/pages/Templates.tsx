import type { TemplateComponent, TemplateView, WaAccount } from '@reaplift/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth/context';
import { Breadcrumbs, ErrorNote, formatDateTime, Panel } from '../components/ui';
import { useAction, useLoad } from '../hooks/useLoad';
import { workspacePath } from '../paths';

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'Draft',
  VALIDATION_FAILED: 'Needs fixing',
  SUBMITTING: 'Sending to Meta',
  PENDING: 'Pending at Meta',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused by Meta',
  DISABLED: 'Disabled by Meta',
};
const EDITABLE = new Set(['DRAFT', 'VALIDATION_FAILED', 'REJECTED']);
const WAITING = new Set(['SUBMITTING', 'PENDING']);
const COMMON_LANGUAGES = [
  ['en_US', 'English (US)'],
  ['en_GB', 'English (UK)'],
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['kn', 'Kannada'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['mr', 'Marathi'],
  ['gu', 'Gujarati'],
  ['bn', 'Bengali'],
  ['ml', 'Malayalam'],
  ['pa', 'Punjabi'],
] as const;
const MEDIA_ACCEPT: Record<string, string> = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf' };
const POLL_MS = 3000;

export const statusWords = (status: string) => STATUS_WORDS[status] ?? status;

function statusClass(status: string) {
  if (status === 'APPROVED') return 'status-active';
  if (status === 'DRAFT' || WAITING.has(status)) return 'status-draft';
  return 'status-suspended';
}

/** The distinct variables in a text, in the order they first appear. */
const variablesIn = (text: string) => [...new Set([...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]!))];

type ButtonDraft = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url: string; phone: string; sample: string };

interface Draft {
  name: string;
  language: string;
  category: string;
  headerType: string;
  headerText: string;
  headerSample: string;
  headerHandle: string[] | null;
  body: string;
  bodySamples: Record<string, string>;
  footer: string;
  buttons: ButtonDraft[];
}

const EMPTY: Draft = {
  name: '',
  language: 'en_US',
  category: 'MARKETING',
  headerType: 'NONE',
  headerText: '',
  headerSample: '',
  headerHandle: null,
  body: '',
  bodySamples: {},
  footer: '',
  buttons: [],
};

function toDraft(template: TemplateView): Draft {
  const part = (type: TemplateComponent['type']) => template.components.find((c) => c.type === type);
  const header = part('HEADER');
  const body = part('BODY');
  const samples = body?.example?.body_text?.[0] ?? [];
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    headerType: header?.format ?? 'NONE',
    headerText: header?.text ?? '',
    headerSample: header?.example?.header_text?.[0] ?? '',
    headerHandle: header?.example?.header_handle ?? null,
    body: body?.text ?? '',
    bodySamples: Object.fromEntries(variablesIn(body?.text ?? '').map((name, i) => [name, samples[i] ?? ''])),
    footer: part('FOOTER')?.text ?? '',
    buttons: (part('BUTTONS')?.buttons ?? []).map((b) => ({
      type: b.type,
      text: b.text,
      url: b.url ?? '',
      phone: b.phone_number ?? '',
      sample: b.example?.[0] ?? '',
    })),
  };
}

function toComponents(draft: Draft): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  if (draft.headerType === 'TEXT') {
    const hasVariable = variablesIn(draft.headerText).length > 0;
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: draft.headerText,
      ...(hasVariable ? { example: { header_text: [draft.headerSample] } } : {}),
    });
  } else if (draft.headerType !== 'NONE') {
    components.push({
      type: 'HEADER',
      format: draft.headerType as 'IMAGE',
      ...(draft.headerHandle ? { example: { header_handle: draft.headerHandle } } : {}),
    });
  }
  const variables = variablesIn(draft.body);
  components.push({
    type: 'BODY',
    text: draft.body,
    ...(variables.length > 0 ? { example: { body_text: [variables.map((name) => draft.bodySamples[name] ?? '')] } } : {}),
  });
  if (draft.footer.trim()) components.push({ type: 'FOOTER', text: draft.footer });
  if (draft.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: draft.buttons.map((b) => ({
        type: b.type,
        text: b.text,
        ...(b.type === 'URL' ? { url: b.url, ...(variablesIn(b.url).length > 0 ? { example: [b.sample] } : {}) } : {}),
        ...(b.type === 'PHONE_NUMBER' ? { phone_number: b.phone } : {}),
      })),
    });
  }
  return components;
}

/** The message as a customer would see it, with samples in place of variables. */
function Preview({ draft }: { draft: Draft }) {
  const fill = (text: string, values: Record<string, string>) =>
    text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (whole, name: string) => values[name] || whole);
  return (
    <div className="template-preview" aria-label="Preview">
      {draft.headerType === 'TEXT' && <strong>{fill(draft.headerText, { 1: draft.headerSample })}</strong>}
      {draft.headerType !== 'NONE' && draft.headerType !== 'TEXT' && <em>[{draft.headerType.toLowerCase()}]</em>}
      <div>{fill(draft.body, draft.bodySamples) || 'Your message appears here.'}</div>
      {draft.footer && <small>{draft.footer}</small>}
      {draft.buttons.map((button, i) => (
        <small key={i}>[{button.text || 'Button'}]</small>
      ))}
    </div>
  );
}

function Editor({ clientId, template, accounts, onSaved }: { clientId: string; template: TemplateView | null; accounts: WaAccount[]; onSaved: (id: string) => void }) {
  const { api } = useAuth();
  const [draft, setDraft] = useState<Draft>(template ? toDraft(template) : EMPTY);
  const [accountId, setAccountId] = useState(template?.waAccountId ?? accounts[0]?.id ?? '');
  const save = useAction();
  const lockedName = Boolean(template?.metaTemplateId);
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const setButton = (index: number, change: Partial<ButtonDraft>) =>
    set({ buttons: draft.buttons.map((b, i) => (i === index ? { ...b, ...change } : b)) });
  const bodyVariables = variablesIn(draft.body);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { name: draft.name.trim(), language: draft.language, category: draft.category, components: toComponents(draft) };
    let id = template?.id ?? '';
    const done = await save.run(async () => {
      if (template) await api.editTemplate(clientId, template.id, body);
      else id = (await api.createTemplate(clientId, { ...body, waAccountId: accountId })).id;
    });
    if (done) onSaved(id);
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      {!template && accounts.length > 1 && (
        <label>
          WhatsApp number
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayPhone}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Template name
        <input value={draft.name} disabled={lockedName} onChange={(e) => set({ name: e.target.value })} placeholder="diwali_offer_2026" required />
        <small className="form-note">
          {lockedName ? 'Meta already has this template, so its name and language cannot change.' : 'Lowercase letters, digits and underscores only.'}
        </small>
      </label>
      <label>
        Language
        <select value={draft.language} disabled={lockedName} onChange={(e) => set({ language: e.target.value })}>
          {COMMON_LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
          {!COMMON_LANGUAGES.some(([code]) => code === draft.language) && <option value={draft.language}>{draft.language}</option>}
        </select>
      </label>
      <label>
        Category
        <select value={draft.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="MARKETING">Marketing: offers and promotions</option>
          <option value="UTILITY">Utility: order updates, reminders, nothing promotional</option>
          <option value="AUTHENTICATION">Authentication: one-time passwords</option>
        </select>
      </label>
      <label>
        Header
        <select value={draft.headerType} onChange={(e) => set({ headerType: e.target.value })}>
          <option value="NONE">None</option>
          <option value="TEXT">Text</option>
          <option value="IMAGE">Image</option>
          <option value="VIDEO">Video</option>
          <option value="DOCUMENT">Document</option>
        </select>
      </label>
      {draft.headerType === 'TEXT' && (
        <label>
          Header text (up to 60 characters)
          <input value={draft.headerText} onChange={(e) => set({ headerText: e.target.value })} />
        </label>
      )}
      {draft.headerType === 'TEXT' && variablesIn(draft.headerText).length > 0 && (
        <label>
          Sample for the header's variable
          <input value={draft.headerSample} onChange={(e) => set({ headerSample: e.target.value })} />
        </label>
      )}
      {draft.headerType !== 'NONE' && draft.headerType !== 'TEXT' && (
        <p className="form-note">Save first, then upload the {draft.headerType.toLowerCase()} on the next screen.</p>
      )}
      <label>
        Message (up to 1,024 characters)
        <textarea rows={4} value={draft.body} onChange={(e) => set({ body: e.target.value })} required />
        <small className="form-note">
          Use {'{{1}}'}, {'{{2}}'} for details that change per person. A message cannot start or end with one, and two cannot be side by side.
        </small>
      </label>
      {bodyVariables.map((name) => (
        <label key={name}>
          Sample for {`{{${name}}}`}
          <input
            value={draft.bodySamples[name] ?? ''}
            onChange={(e) => set({ bodySamples: { ...draft.bodySamples, [name]: e.target.value } })}
            placeholder="What Meta's reviewer sees"
          />
        </label>
      ))}
      <label>
        Footer (optional, up to 60 characters)
        <input value={draft.footer} onChange={(e) => set({ footer: e.target.value })} />
      </label>

      <div>
        <strong>Buttons (optional)</strong>
        {draft.buttons.map((button, index) => (
          <div className="button-row" key={index}>
            <label>
              Type
              <select value={button.type} onChange={(e) => setButton(index, { type: e.target.value as ButtonDraft['type'] })}>
                <option value="QUICK_REPLY">Quick reply</option>
                <option value="URL">Website</option>
                <option value="PHONE_NUMBER">Call</option>
              </select>
            </label>
            <label>
              Button text
              <input value={button.text} onChange={(e) => setButton(index, { text: e.target.value })} required />
            </label>
            {button.type === 'URL' && (
              <label>
                Web address
                <input value={button.url} onChange={(e) => setButton(index, { url: e.target.value })} placeholder="https://example.com" required />
              </label>
            )}
            {button.type === 'URL' && variablesIn(button.url).length > 0 && (
              <label>
                Sample
                <input value={button.sample} onChange={(e) => setButton(index, { sample: e.target.value })} />
              </label>
            )}
            {button.type === 'PHONE_NUMBER' && (
              <label>
                Phone number
                <input value={button.phone} onChange={(e) => setButton(index, { phone: e.target.value })} placeholder="919812345678" required />
              </label>
            )}
            <button type="button" className="small-button" onClick={() => set({ buttons: draft.buttons.filter((_, i) => i !== index) })}>
              Remove
            </button>
          </div>
        ))}
        <p>
          <button
            type="button"
            className="small-button"
            onClick={() => set({ buttons: [...draft.buttons, { type: 'QUICK_REPLY', text: '', url: '', phone: '', sample: '' }] })}
          >
            Add a button
          </button>
        </p>
      </div>

      <div>
        <strong>Preview</strong>
        <Preview draft={draft} />
      </div>

      <ErrorNote message={save.error} />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={save.busy}>
          Save draft
        </button>
      </div>
    </form>
  );
}

function TemplateDetail({ clientId, id, accounts }: { clientId: string; id: string; accounts: WaAccount[] }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const list = workspacePath(clientId, 'templates');
  const { data: template, error, reload } = useLoad(() => api.template(clientId, id), [api, clientId, id]);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [copyName, setCopyName] = useState('');

  // Meta answers in the background, so a template on its way shows its result without a reload.
  const waiting = template ? WAITING.has(template.status) : false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  if (error) return <ErrorNote message={error} />;
  if (!template) return <p>Loading…</p>;
  const canEdit = EDITABLE.has(template.status);
  const canSubmit = template.status === 'DRAFT' || template.status === 'VALIDATION_FAILED';
  const header = template.components.find((c) => c.type === 'HEADER');
  const needsFile = header?.format && header.format !== 'TEXT';

  const submit = () =>
    action.run(async () => {
      try {
        await api.submitTemplate(clientId, id);
      } catch (err) {
        // 422 means our own checks stopped it. The reasons are on the template, and shown below.
        if (!(err instanceof ApiError && err.status === 422)) throw err;
      }
      reload();
    });

  const upload = (file: File) =>
    action.run(async () => {
      await api.uploadTemplateMedia(clientId, id, file);
      reload();
    });

  const copy = () =>
    action.run(async () => {
      const made = await api.copyTemplate(clientId, id, copyName.trim());
      navigate(`${list}?template=${made.id}`);
    });

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Templates', to: list }, { label: template.name }]} />
      <Panel
        title={template.name}
        actions={<span className={`status-pill ${statusClass(template.status)}`}>{statusWords(template.status)}</span>}
      >
        <ErrorNote message={action.error} />
        {template.status === 'VALIDATION_FAILED' && template.validationErrors && (
          <ul className="rule-list" aria-label="What to fix">
            {template.validationErrors.map((failure, i) => (
              <li key={i}>
                {failure.message}
                <small>{failure.fix}</small>
              </li>
            ))}
          </ul>
        )}
        {template.status === 'REJECTED' && (
          <div className="warning-note" role="status">
            <strong>Meta rejected this template.</strong> {template.rejectionExplanation}
            {template.metaRecommendation && <p>Meta's recommendation: {template.metaRecommendation}</p>}
            {template.rejectionReason && <small className="form-note">Meta's reason: {template.rejectionReason}</small>}
          </div>
        )}
        {WAITING.has(template.status) && (
          <p className="form-note">
            {template.status === 'SUBMITTING' ? 'Sending to Meta now.' : "With Meta for review. You will be told when it's decided; it can take from minutes to a day."}
          </p>
        )}
        {template.status === 'APPROVED' && <p className="form-success">Approved. It can be used in campaigns.</p>}

        {editing ? (
          <Editor
            clientId={clientId}
            template={template}
            accounts={accounts}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        ) : (
          <>
            <Preview draft={toDraft(template)} />
            <p className="form-note">
              {template.language}, {template.category.toLowerCase()}, updated {formatDateTime(template.updatedAt)}
            </p>
            {needsFile && canEdit && (
              <label className="filter-row">
                {header?.example?.header_handle ? `Replace the ${header.format?.toLowerCase()}` : `Upload the ${header?.format?.toLowerCase()}`}
                <input
                  type="file"
                  accept={MEDIA_ACCEPT[header!.format!]}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </label>
            )}
            <div className="row-actions">
              {canEdit && (
                <button type="button" className="small-button" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canSubmit && (
                <button type="button" className="primary-button" disabled={action.busy} onClick={() => void submit()}>
                  Submit to Meta
                </button>
              )}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Copy into a new draft" hint="An approved template is never edited, so a change starts as a copy with a new name.">
        <div className="filter-row">
          <label>
            New name
            <input value={copyName} onChange={(e) => setCopyName(e.target.value)} placeholder={`${template.name}_v2`} />
          </label>
          <button type="button" className="small-button" disabled={action.busy || !copyName.trim()} onClick={() => void copy()}>
            Copy
          </button>
        </div>
      </Panel>
    </div>
  );
}

export function Templates() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selected = params.get('template');
  const creating = params.get('new') === '1';
  const list = workspacePath(clientId, 'templates');
  const templates = useLoad(() => api.templates(clientId), [api, clientId, selected, creating]);
  const accounts = useLoad(() => api.waAccounts(clientId), [api, clientId]);
  const numbers = accounts.data?.items ?? [];

  if (selected) return <TemplateDetail clientId={clientId} id={selected} accounts={numbers} />;

  if (creating) {
    return (
      <div className="page-stack">
        <Breadcrumbs items={[{ label: 'Templates', to: list }, { label: 'New template' }]} />
        <Panel title="New template" hint="Saved as a draft first. Our checks run when you submit, before anything goes to Meta, so most mistakes are caught at once.">
          {accounts.data && <Editor clientId={clientId} template={null} accounts={numbers} onSaved={(id) => navigate(`${list}?template=${id}`)} />}
        </Panel>
      </div>
    );
  }

  return (
    <Panel
      title="Templates"
      hint="Pre-approved messages. WhatsApp requires one for messages a business starts, so each goes to Meta for review before it can be used in a campaign."
      actions={
        numbers.length > 0 ? (
          <Link className="primary-button" to={`${list}?new=1`}>
            New template
          </Link>
        ) : undefined
      }
    >
      <ErrorNote message={templates.error ?? accounts.error} />
      {accounts.data && numbers.length === 0 && <p className="empty-state">Connect a WhatsApp number first. See Settings.</p>}
      {templates.data?.items.length === 0 && numbers.length > 0 && <p className="empty-state">No templates yet.</p>}
      {templates.data && templates.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Language</th>
                <th>Category</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {templates.data.items.map((template) => (
                <tr key={template.id}>
                  <td>
                    <Link to={`${list}?template=${template.id}`}>{template.name}</Link>
                  </td>
                  <td>{template.language}</td>
                  <td>{template.category.toLowerCase()}</td>
                  <td>
                    <span className={`status-pill ${statusClass(template.status)}`}>{statusWords(template.status)}</span>
                  </td>
                  <td>{formatDateTime(template.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
