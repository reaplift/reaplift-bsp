import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { PasswordField } from '../../components/PasswordField';
import { Breadcrumbs, ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

export function StaffPage() {
  const { api } = useAuth();
  const staff = useLoad(() => api.adminUsers({ role: 'staff' }), [api]);
  const clients = useLoad(() => api.adminClients(), [api]);
  const add = useAction();
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // Arriving from a client's page: that client is remembered, shown, and ticked for a new person.
  const [params] = useSearchParams();
  const fromClient = params.get('client');
  const [newPicked, setNewPicked] = useState<string[]>(fromClient ? [fromClient] : []);
  const [search, setSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const allClients = clients.data?.items ?? [];
  const resetName = staff.data?.items.find((person) => person.id === resetFor)?.name ?? '';
  const fromName = allClients.find((client) => client.id === fromClient)?.name;
  const term = search.trim().toLowerCase();
  const shownStaff = (staff.data?.items ?? []).filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(term));
  const nameOf = (id: string) => {
    const client = allClients.find((c) => c.id === id);
    if (!client) return id;
    return client.status === 'suspended' ? `${client.name} (suspended)` : client.name;
  };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const done = await add.run(() =>
      api.createUser({
        name: String(form.get('name')),
        email: String(form.get('email')),
        role: 'staff',
        password: String(form.get('password')),
        clientIds: newPicked,
      }),
    );
    if (done) {
      element.reset();
      setNewPicked(fromClient ? [fromClient] : []);
      staff.reload();
      setMessage('Staff member created. Tell them the first password by phone; the email does not contain it.');
    }
  };

  const saveAssignment = async (id: string) => {
    if (await action.run(() => api.setStaffClients(id, picked))) {
      setEditing(null);
      staff.reload();
      setMessage('Assignment saved. It applies at once.');
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!window.confirm(`Reset the password for ${resetName}? They are logged out at once and must choose a new one.`)) return;
    if (await action.run(() => api.resetPassword(resetFor!, String(form.get('password'))))) {
      setResetFor(null);
      setMessage('Password reset. They must choose a new one at next login.');
    }
  };

  const ClientChecks = ({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) => (
    <div>
      {allClients.length > 8 && (
        <label>
          Find a client
          <input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
        </label>
      )}
      {allClients.filter((client) => client.name.toLowerCase().includes(clientSearch.trim().toLowerCase())).map((client) => (
        <label key={client.id} className="check-row">
          <input type="checkbox" checked={value.includes(client.id)} onChange={() => onChange(toggle(value, client.id))} />
          {client.name}
        </label>
      ))}
    </div>
  );

  return (
    <div className="page-stack">
      <Breadcrumbs
        items={
          fromClient && fromName
            ? [{ label: 'Clients', to: '/admin/clients' }, { label: fromName, to: `/admin/clients/${fromClient}?tab=staff` }, { label: 'Staff' }]
            : [{ label: 'Staff' }]
        }
      />
      {message && <p className="form-success">{message}</p>}
      {message && fromClient && fromName && (
        <p>
          <Link className="link-button" to={`/admin/clients/${fromClient}?tab=staff`}>
            Back to {fromName}
          </Link>
        </p>
      )}
      <Panel title="Staff" hint="ReapLift team members. Staff can work only in the clients assigned to them, and cannot open these admin pages.">
        <ErrorNote message={staff.error ?? clients.error ?? action.error} />
        {(staff.data?.items.length ?? 0) > 0 && (
          <div className="filter-row">
            <label>
              Search by name or email
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
        )}
        {staff.data?.items.length === 0 && <p className="empty-state">No staff yet.</p>}
        {staff.data && staff.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Clients</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownStaff.map((person) => (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>{person.email}</td>
                    <td>
                      <StatusPill status={person.status} /> {person.locked && <span className="status-pill status-suspended">Locked</span>}
                    </td>
                    <td>
                      {editing === person.id ? (
                        <>
                          <ClientChecks value={picked} onChange={setPicked} />
                          <button type="button" className="small-button" onClick={() => void saveAssignment(person.id)}>
                            Save
                          </button>
                        </>
                      ) : (
                        person.assignedClientIds.map(nameOf).join(', ') || 'None'
                      )}
                    </td>
                    <td className="row-actions">
                      {person.locked && (
                        <button
                          type="button"
                          className="small-button"
                          disabled={action.busy}
                          onClick={async () => {
                            if (await action.run(() => api.unlockUser(person.id))) staff.reload();
                          }}
                        >
                          Unlock
                        </button>
                      )}
                      <button
                        type="button"
                        className="small-button"
                        onClick={() => {
                          setEditing(person.id);
                          setPicked(person.assignedClientIds);
                        }}
                      >
                        Assign clients
                      </button>
                      <button
                        type="button"
                        className="small-button"
                        onClick={async () => {
                          const next = person.status === 'active' ? 'disabled' : 'active';
                          if (next === 'disabled' && !window.confirm(`Disable ${person.name}? They are logged out at once and cannot log in.`)) return;
                          if (await action.run(() => api.setUserStatus(person.id, next))) staff.reload();
                        }}
                      >
                        {person.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="small-button" onClick={() => setResetFor(person.id)}>
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
            <button type="submit" className="primary-button" disabled={action.busy}>
              Set password
            </button>
            <button type="button" className="small-button" onClick={() => setResetFor(null)}>
              Cancel
            </button>
          </form>
        )}
      </Panel>

      <Panel title={fromName ? `Add a staff member for ${fromName}` : 'Add a staff member'}>
        <form className="form-grid" onSubmit={create}>
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
          <fieldset>
            <legend>Clients</legend>
            <ClientChecks value={newPicked} onChange={setNewPicked} />
          </fieldset>
          <ErrorNote message={add.error} />
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={add.busy}>
              Add staff member
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
