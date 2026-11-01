import { formatPaise } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { PasswordField } from '../../components/PasswordField';
import { ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';
import { workspacePath } from '../../paths';

export function ClientDetailPage() {
  const { id = '' } = useParams();
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

  const toggleUser = async (userId: string, current: string) => {
    if (await userAction.run(() => api.setUserStatus(userId, current === 'active' ? 'disabled' : 'active'))) reload();
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const done = await userAction.run(() => api.resetPassword(resetFor!, String(form.get('password'))));
    if (done) {
      setResetFor(null);
      setMessage('Password reset. They must choose a new one at next login.');
    }
  };

  return (
    <div className="page-stack">
      {message && <p className="form-success">{message}</p>}
      <Panel
        title={client.name}
        actions={
          <Link className="link-button" to={workspacePath(id, 'dashboard')}>
            Open workspace
          </Link>
        }
      >
        <p>
          <StatusPill status={client.status} /> Balance {formatPaise(client.balancePaise ?? 0)}, on hold{' '}
          {formatPaise(client.onHoldPaise ?? 0)}
        </p>
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
        hint="While suspended, the client's users and staff cannot open it and nothing is sent. Its wallet stays as it is, and a super admin can still open it. The note goes in the audit log and to the client."
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
      </Panel>

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
                      <StatusPill status={user.status} />
                    </td>
                    <td className="row-actions">
                      <button type="button" className="small-button" onClick={() => void toggleUser(user.id, user.status)}>
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

      <Panel title="Assigned staff" hint="ReapLift team members who can work in this client's workspace. Change this on the Staff page.">
        {client.staff.length === 0 ? (
          <p className="empty-state">No staff assigned.</p>
        ) : (
          <ul>
            {client.staff.map((person) => (
              <li key={person.id}>
                {person.name} ({person.email})
              </li>
            ))}
          </ul>
        )}
        <Link className="link-button" to="/admin/staff">
          Manage staff
        </Link>
      </Panel>
    </div>
  );
}
