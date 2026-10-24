import { StatCard } from '../components/StatCard';
import { adminClients, teamMembers } from '../data/mockData';

export function Admin() {
  const activeClientCount = adminClients.filter((client) => client.status === 'active').length;

  return (
    <div className="page-stack">
      <section className="stats-grid">
        <StatCard label="Clients" value={String(adminClients.length)} trend={`${activeClientCount} active`} />
        <StatCard label="Staff users" value={String(teamMembers.length)} trend="Coverage ready" />
        <StatCard label="Wallet health" value="₹4.6L" trend="+12% month" />
        <StatCard label="Alerts" value="2" trend="Needs review" />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Client management</h2>
          <button type="button" className="primary-button">
            + Add client
          </button>
        </div>

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
              {adminClients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                  </td>
                  <td>{client.contactEmail ?? 'No email'}</td>
                  <td>{client.assignedStaff}</td>
                  <td>₹{client.walletBalance.toLocaleString('en-IN')}</td>
                  <td>
                    <span className={`status-pill status-${client.status}`}>{client.status}</span>
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
