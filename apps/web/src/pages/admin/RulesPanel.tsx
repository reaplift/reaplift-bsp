import type { RuleInput, RuleView } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

const RULE_NAMES: Record<string, string> = {
  repeat_within_hours: 'No repeat of the same template',
  marketing_cap: 'Marketing messages per number',
};

/** A rule's setting in words, as the summary's "Blocked" reasons read. */
export function ruleWords(rule: Pick<RuleView, 'type' | 'values'>) {
  const v = rule.values as { hours?: number; count?: number; period?: string };
  if (rule.type === 'repeat_within_hours') return `Not the same template to a number within ${v.hours} hours`;
  if (rule.type === 'marketing_cap') return `At most ${v.count} marketing message${v.count === 1 ? '' : 's'} per number a ${v.period}`;
  return rule.type;
}

/** Rules that block numbers at summary and confirm (M8 task 8.4), for all clients or one. */
export function RulesPanel() {
  const { api } = useAuth();
  const rules = useLoad(() => api.rules(), [api]);
  const clients = useLoad(() => api.adminClients(), [api]);
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [type, setType] = useState<RuleInput['type']>('repeat_within_hours');

  const clientName = (id: string | null) =>
    id === null ? 'All clients' : (clients.data?.items.find((c) => c.id === id)?.name ?? 'A client');
  const current = rules.data?.items.find((r) => r.type === type && r.clientId === (target || null));
  const values = (current?.values ?? {}) as { hours?: number; count?: number; period?: string };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabled = form.get('enabled') === 'on';
    const clientId = target || null;
    const body: RuleInput =
      type === 'repeat_within_hours'
        ? { type, clientId, enabled, values: { hours: Number(form.get('hours')) } }
        : { type, clientId, enabled, values: { count: Number(form.get('count')), period: form.get('period') === 'week' ? 'week' : 'day' } };
    setMessage(null);
    if (await action.run(() => api.saveRule(body))) {
      rules.reload();
      setMessage(`Saved for ${clientId === null ? 'all clients' : clientName(clientId)}. It applies from the next summary or confirm.`);
    }
  };

  return (
    <Panel
      title="Rules"
      hint="Numbers a rule catches are blocked in the campaign's summary and at confirm, and charged as blocked (HLD section 5). A rule set for one client replaces the all-clients rule of the same kind for that client."
    >
      <ErrorNote message={rules.error ?? clients.error ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {rules.data?.items.length === 0 && <p className="empty-state">No rules yet. Nothing is blocked except opt-outs.</p>}
      {rules.data && rules.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Applies to</th>
                <th>Rule</th>
                <th>State</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {rules.data.items.map((rule) => (
                <tr key={rule.id}>
                  <td>{clientName(rule.clientId)}</td>
                  <td>{ruleWords(rule)}</td>
                  <td>
                    <span className={`status-pill ${rule.enabled ? 'status-active' : 'status-draft'}`}>{rule.enabled ? 'On' : 'Off'}</span>
                  </td>
                  <td>{formatDateTime(rule.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="form-grid" onSubmit={save} key={`${target}:${type}:${current?.updatedAt ?? ''}`}>
        <label>
          Applies to
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">All clients</option>
            {clients.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rule
          <select value={type} onChange={(e) => setType(e.target.value as RuleInput['type'])}>
            {Object.entries(RULE_NAMES).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {type === 'repeat_within_hours' ? (
          <label>
            Hours since the same template went to the number
            <input name="hours" type="number" min={1} max={8760} required defaultValue={values.hours ?? 24} />
          </label>
        ) : (
          <>
            <label>
              At most this many marketing messages
              <input name="count" type="number" min={1} required defaultValue={values.count ?? 2} />
            </label>
            <label>
              Per
              <select name="period" defaultValue={values.period ?? 'week'}>
                <option value="day">day (24 hours)</option>
                <option value="week">week (7 days)</option>
              </select>
            </label>
          </>
        )}
        <label className="checkbox-row">
          <input name="enabled" type="checkbox" defaultChecked={current?.enabled ?? true} /> On
        </label>
        <div className="form-actions">
          <button type="submit" className="primary-button" disabled={action.busy}>
            Save rule
          </button>
        </div>
      </form>
    </Panel>
  );
}
