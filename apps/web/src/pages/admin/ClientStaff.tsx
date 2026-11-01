import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/context';
import { ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

/** Adds and removes this client's staff here, so nobody has to leave the page and remember which client it was. */
export function ClientStaff({
  clientId,
  clientName,
  suspended,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  suspended: boolean;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const staff = useLoad(() => api.adminUsers({ role: 'staff' }), [api]);
  const action = useAction();
  const [picked, setPicked] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const people = useMemo(() => staff.data?.items ?? [], [staff.data]);
  const assigned = people.filter((person) => person.assignedClientIds.includes(clientId));
  const available = people.filter((person) => !person.assignedClientIds.includes(clientId) && person.status === 'active');
  const chosen = available.find((person) => person.id === picked);

  /** Reads the person's list again just before saving, as saving replaces the whole list. */
  const change = (personId: string, name: string, add: boolean) =>
    action.run(async () => {
      const fresh = (await api.adminUsers({ role: 'staff' })).items.find((person) => person.id === personId);
      const others = (fresh?.assignedClientIds ?? []).filter((id) => id !== clientId);
      await api.setStaffClients(personId, add ? [...others, clientId] : others);
      staff.reload();
      onChanged();
      setMessage(add ? `${name} can now work in ${clientName}.` : `${name} no longer works in ${clientName}.`);
    });

  const clients = (count: number) => `${count} ${count === 1 ? 'client' : 'clients'}`;

  return (
    <Panel
      title="Assigned staff"
      hint="ReapLift team members who can work in this client's workspace. Changes apply at once, and the person is told. The count shows how many active clients each person already has, so nobody is given too many; suspended clients are not counted."
    >
      <ErrorNote message={staff.error ?? action.error} />
      {message && <p className="form-success">{message}</p>}

      {suspended && assigned.length > 0 && (
        <p className="warning-note">
          {clientName} is suspended, so these people cannot open it and it does not count towards their clients. They
          return to it automatically when it is reactivated. Use Remove if they should not.
        </p>
      )}
      {staff.data && assigned.length === 0 && <p className="empty-state">No staff assigned to {clientName} yet.</p>}
      {assigned.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Has</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {assigned.map((person) => (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td>{person.email}</td>
                  <td>
                    <StatusPill status={person.status} />
                  </td>
                  <td>{clients(person.activeClientCount)}</td>
                  <td>
                    <button
                      type="button"
                      className="small-button"
                      disabled={action.busy}
                      aria-label={`Remove ${person.name} from ${clientName}`}
                      onClick={() => void change(person.id, person.name, false)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Add staff to {clientName}</h3>
      {staff.data && available.length === 0 && <p className="empty-state">All active staff are already assigned.</p>}
      {available.length > 0 && (
        <div className="filter-row">
          <label>
            Staff member
            <select value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Choose a person…</option>
              {available.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} ({person.email}), has {clients(person.activeClientCount)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={action.busy || !chosen}
            onClick={async () => {
              if (chosen && (await change(chosen.id, chosen.name, true))) setPicked('');
            }}
          >
            Add to {clientName}
          </button>
        </div>
      )}

      <p>
        <Link className="link-button" to={`/admin/staff?client=${clientId}`}>
          Create a new staff member for {clientName}
        </Link>
      </p>
    </Panel>
  );
}
