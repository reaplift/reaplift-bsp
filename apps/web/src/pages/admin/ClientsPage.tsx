import { formatPaise } from '@reaplift/shared';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

export function ClientsPage() {
  const { api, refresh } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(() => api.adminClients(), [api]);
  const create = useAction();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let id = '';
    const done = await create.run(async () => {
      const made = await api.createClient({
        name: String(form.get('name')),
        countryCallingCode: '91',
        contactEmail: String(form.get('contactEmail')),
      });
      id = made.id;
    });
    if (done) {
      await refresh();
      reload();
      navigate(`/admin/clients/${id}?tab=money`);
    }
  };

  return (
    <div className="page-stack">
      <Panel title="Clients" hint="Every business using ReapLift. Balance is what is in its wallet; On hold is set aside for scheduled campaigns.">
        <ErrorNote message={error} />
        {data && data.items.length === 0 && <p className="empty-state">No clients yet. Add the first one below.</p>}
        {data && data.items.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Contact email</th>
                  <th>Balance</th>
                  <th>On hold</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link to={`/admin/clients/${client.id}`}>{client.name}</Link>
                    </td>
                    <td>
                      <StatusPill status={client.status} />
                      {client.suspendedNote && <small className="form-note"> {client.suspendedNote}</small>}
                    </td>
                    <td>{client.contactEmail}</td>
                    <td>{formatPaise(client.balancePaise ?? 0)}</td>
                    <td>{formatPaise(client.onHoldPaise ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Add a client">
        <form className="form-grid" onSubmit={submit}>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            Country
            <select name="country" defaultValue="91" disabled>
              <option value="91">India (+91)</option>
            </select>
          </label>
          <label>
            Contact email
            <input name="contactEmail" type="email" required />
          </label>
          <ErrorNote message={create.error} />
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={create.busy}>
              Add client
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
