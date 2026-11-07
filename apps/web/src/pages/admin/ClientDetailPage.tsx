import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { PasswordField } from '../../components/PasswordField';
import { Breadcrumbs, ErrorNote, formatDateTime, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';
import { workspacePath } from '../../paths';
import { ClientMoney, ClientPrices } from './ClientMoney';
import { ClientNumber } from './ClientNumber';
import { ClientOptOuts } from './ClientOptOuts';
import { ClientStaff } from './ClientStaff';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'money', label: 'Money and prices' },
  { key: 'number', label: 'WhatsApp number' },
  { key: 'optouts', label: 'Opt-outs' },
  { key: 'logins', label: 'Logins' },
  { key: 'staff', label: 'Staff' },
] as const;

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview';
  const { api, refresh } = useAuth();
  const { data: client, error, reload } = useLoad(() => api.adminClient(id), [api, id]);
  const edit = useAction();
  const status = useAction();
  const addUser = useAction();
  const userAction = useAction();
  const [note, setNote] = useState('');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (error) return <ErrorNote message={error} />;
  if (!client) return <p>Loading…</p>;
  const suspended = client.status === 'suspended';
  const latestSuspension = client.statusHistory.find((entry) => entry.action === 'client.suspended');
  const resetName = client.users.find((user) => user.id === resetFor)?.name ?? '';

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const done = await edit.run(() =>
      api.editClient(id, { name: String(form.get('name')), contactEmail: String(form.get('contactEmail')) }),
    );
    if (done) {
      await refresh();
      reload();
      setMessage('Saved.');
    }
  };

  const changeStatus = async () => {
    const done = await status.run(() => api.setClientSuspended(id, !suspended, note));
    if (done) {
      setNote('');
      await refresh();
      reload();
    }
  };

  const createLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const done = await addUser.run(() =>
      api.createUser({
        name: String(form.get('name')),
        email: String(form.get('email')),
        role: 'client',
        clientId: id,
        password: String(form.get('password')),
      }),
    );
    if (done) {
      element.reset();
      reload();
      setMessage('Login created. Tell them the first password by phone; the email does not contain it.');
    }
  };

  const unlock = async (userId: string) => {
    if (await userAction.run(() => api.unlockUser(userId))) {
      reload();
      setMessage('Unlocked. They can log in with their password again.');
    }
  };

  const toggleUser = async (userId: string, current: string, name: string) => {
    if (current === 'active' && !window.confirm(`Disable ${name}? They are logged out at once and cannot log in.`)) return;
    if (await userAction.run(() => api.setUserStatus(userId, current === 'active' ? 'disabled' : 'active'))) reload();
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!window.confirm(`Reset the password for ${resetName}? They are logged out at once and must choose a new one.`)) return;
    const done = await userAction.run(() => api.resetPassword(resetFor!, String(form.get('password'))));
    if (done) {
      setResetFor(null);
      setMessage('Password reset. They must choose a new one at next login.');
    }
  };

  return (
    <div className="page-stack">
      <Breadcrumbs items={[{ label: 'Clients', to: '/admin/clients' }, { label: client.name }]} />
      {message && <p className="form-success">{message}</p>}
      <div className="client-title">
        <h2>{client.name}</h2>
        <StatusPill status={client.status} />
        <Link className="link-button" to={workspacePath(id, 'dashboard')}>
          Open workspace
        </Link>
      </div>
      <nav className="tabs" aria-label="Client sections">
        {TABS.map(({ key, label }) => (
          <Link key={key} to={`/admin/clients/${id}?tab=${key}`} className={tab === key ? 'tab active' : 'tab'} aria-current={tab === key ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      {suspended && latestSuspension && (
        <p className="warning-note" role="status">
          Suspended on {formatDateTime(latestSuspension.at)}
          {latestSuspension.byName ? ` by ${latestSuspension.byName}` : ''}. Reason: {latestSuspension.note}
        </p>
      )}

      {tab === 'overview' && (
        <>
      <Panel title="Details">
        <form className="form-grid" onSubmit={saveEdit}>
          <label>
            Name
            <input name="name" defaultValue={client.name} required />
          </label>
          <label>
            Contact email
            <input name="contactEmail" type="email" defaultValue={client.contactEmail ?? ''} required />
          </label>
          <ErrorNote message={edit.error} />
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={edit.busy}>
              Save
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title={suspended ? 'Reactivate' : 'Suspend'}
        hint="While suspended, the client's users and staff cannot open it and nothing is sent. Its wallet stays as it is, and a super admin can still open it. The note is emailed to the client's users and assigned staff, so write it for them to read."
      >
        <div className="filter-row">
          <label>
            Note (required)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="invoice overdue" />
          </label>
          <button type="button" className="primary-button" disabled={status.busy || !note.trim()} onClick={() => void changeStatus()}>
            {suspended ? 'Reactivate client' : 'Suspend client'}
          </button>
        </div>
        <ErrorNote message={status.error} />
        {client.statusHistory.length > 0 && (
          <>
            <h3>History</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Who</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {client.statusHistory.map((entry) => (
                    <tr key={`${entry.at}-${entry.action}`}>
                      <td>{formatDateTime(entry.at)}</td>
                      <td>{entry.action === 'client.suspended' ? 'Suspended' : 'Reactivated'}</td>
                      <td>{entry.byName}</td>
                      <td>{entry.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

        </>
      )}

      {tab === 'money' && (
        <>
          <ClientMoney clientId={id} onChanged={reload} />
          <ClientPrices clientId={id} />
        </>
      )}

      {tab === 'number' && <ClientNumber clientId={id} />}

      {tab === 'optouts' && <ClientOptOuts clientId={id} />}

      {tab === 'logins' && (
      <Panel title="Logins" hint="The people at this client who can log in. Disabling logs them out at once. Resetting a password logs them out and makes them choose a new one.">
        <ErrorNote message={userAction.error} />
        {client.users.length === 0 ? (
          <p className="empty-state">No logins yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {client.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <StatusPill status={user.status} /> {user.locked && <span className="status-pill status-suspended">Locked</span>}
                    </td>
                    <td className="row-actions">
                      {user.locked && (
                        <button type="button" className="small-button" disabled={userAction.busy} onClick={() => void unlock(user.id)}>
                          Unlock
                        </button>
                      )}
                      <button type="button" className="small-button" onClick={() => void toggleUser(user.id, user.status, user.name)}>
                        {user.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="small-button" onClick={() => setResetFor(user.id)}>
                        Reset password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resetFor && (
          <form className="filter-row" onSubmit={resetPassword}>
            <PasswordField
              label={`New first password for ${resetName}`}
              name="password"
              autoComplete="new-password"
              minLength={10}
              canGenerate
              hint="At least 10 characters. Letters, numbers and symbols are all allowed. Tell the person by phone; the email does not contain it."
            />
            <button type="submit" className="primary-button" disabled={userAction.busy}>
              Set password
            </button>
            <button type="button" className="small-button" onClick={() => setResetFor(null)}>
              Cancel
            </button>
          </form>
        )}

        <h3>Add a login</h3>
        <form className="form-grid" onSubmit={createLogin}>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <PasswordField
            label="First password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            canGenerate
            hint="At least 10 characters. Letters, numbers and symbols are all allowed. Tell the person by phone; the email does not contain it."
          />
          <ErrorNote message={addUser.error} />
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={addUser.busy}>
              Add login
            </button>
          </div>
        </form>
      </Panel>

      )}

      {tab === 'staff' && <ClientStaff clientId={id} clientName={client.name} suspended={suspended} onChanged={reload} />}
    </div>
  );
}
