import { type FormEvent, useEffect, useState } from 'react';
import type { AdminClient } from '@reaplift/shared';
import { StatCard } from '../components/StatCard';
import { teamMembers } from '../data/mockData';

const emptyForm = {
  name: '',
  contactEmail: '',
  assignedStaff: 'Aisha Shah',
  status: 'active' as const,
  walletBalance: '0',
};

type AdminProps = {
  authHeader: Record<string, string>;
};

export function Admin({ authHeader }: AdminProps) {
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [showForm, setShowForm] = useState(false);

  const activeClientCount = clients.filter((client) => client.status === 'active').length;

  useEffect(() => {
    fetch('/api/admin/clients', { headers: authHeader })
      .then((res) => res.json())
      .then((data) => setClients(data as AdminClient[]))
      .catch(() => setClients([]));
  }, [authHeader]);

  const handleAddClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextClient = {
      name: String(formData.get('name') ?? '').trim(),
      contactEmail: String(formData.get('contactEmail') ?? '').trim() || null,
      assignedStaff: String(formData.get('assignedStaff') ?? 'Aisha Shah').trim(),
      status: (String(formData.get('status') ?? 'active') as AdminClient['status']) || 'active',
      walletBalance: Number(String(formData.get('walletBalance') ?? '0')) || 0,
    };

    if (!nextClient.name) return;

    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify(nextClient),
    });

    if (!res.ok) return;

    const created = (await res.json()) as AdminClient;
    setClients((current) => [created, ...current]);
    setShowForm(false);
    event.currentTarget.reset();
  };

  const handleToggleClientStatus = async (clientId: string) => {
    const client = clients.find((entry) => entry.id === clientId);
    if (!client) return;

    const nextStatus = client.status === 'active' ? 'suspended' : 'active';
    const res = await fetch(`/api/admin/clients/${clientId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) return;

    const updated = (await res.json()) as AdminClient;
    setClients((current) => current.map((entry) => (entry.id === clientId ? updated : entry)));
  };

  const handleAssignStaff = async (clientId: string) => {
    const nextStaff = window.prompt('Assign staff member', 'Aisha Shah');
    if (!nextStaff || !nextStaff.trim()) return;

    const res = await fetch(`/api/admin/clients/${clientId}/staff`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ assignedStaff: nextStaff.trim() }),
    });

    if (!res.ok) return;

    const updated = (await res.json()) as AdminClient;
    setClients((current) => current.map((entry) => (entry.id === clientId ? updated : entry)));
  };

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Clients" value={String(clients.length)} trend={`${activeClientCount} active`} />
        <StatCard label="Staff users" value={String(teamMembers.length)} trend="Coverage ready" />
        <StatCard label="Wallet health" value="₹4.6L" trend="+12% month" />
        <StatCard label="Alerts" value="2" trend="Needs review" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Client management</h2>
          <button type="button" className="primary-button" onClick={() => setShowForm((current) => !current)}>
            {showForm ? 'Hide form' : '+ Add client'}
          </button>
        </div>

        {showForm && (
          <form className="form-grid compact-form" onSubmit={handleAddClient}>
            <label>
              <span>Client name</span>
              <input name="name" type="text" placeholder="Northwind Labs" defaultValue={emptyForm.name} />
            </label>

            <label>
              <span>Contact email</span>
              <input name="contactEmail" type="email" placeholder="ops@company.com" defaultValue={emptyForm.contactEmail} />
            </label>

            <label>
              <span>Assigned staff</span>
              <select name="assignedStaff" defaultValue={emptyForm.assignedStaff}>
                <option value="Aisha Shah">Aisha Shah</option>
                <option value="Rahul S">Rahul S</option>
                <option value="Mira Nair">Mira Nair</option>
              </select>
            </label>

            <label>
              <span>Wallet balance</span>
              <input name="walletBalance" type="number" placeholder="0" defaultValue={emptyForm.walletBalance} />
            </label>

            <label>
              <span>Status</span>
              <select name="status" defaultValue={emptyForm.status}>
                <option value="active">active</option>
                <option value="suspended">suspended</option>
              </select>
            </label>

            <div className="form-actions">
              <button type="submit" className="primary-button">
                Save client
              </button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Staff</th>
                <th>Wallet</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                  </td>
                  <td>{client.contactEmail ?? 'No email'}</td>
                  <td>
                    <div className="status-row">
                      <span>{client.assignedStaff}</span>
                      <button type="button" className="link-button" onClick={() => handleAssignStaff(client.id)}>
                        Change
                      </button>
                    </div>
                  </td>
                  <td>₹{client.walletBalance.toLocaleString('en-IN')}</td>
                  <td>
                    <div className="status-row">
                      <span className={`status-pill status-${client.status}`}>{client.status}</span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => handleToggleClientStatus(client.id)}
                      >
                        {client.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Operations team</h2>
          <button type="button" className="link-button">
            View roles
          </button>
        </div>

        <div className="team-list">
          {teamMembers.map((member) => (
            <div className="team-row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <small>{member.email}</small>
              </div>
              <span className="role-badge">{member.role}</span>
              <span>{member.clientCount} clients</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
