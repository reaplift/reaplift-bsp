import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

const SOURCE_WORDS: Record<string, string> = { stop_reply: 'Customer replied', upload: 'Added here', manual: 'Added by hand' };

/** Numbers this client must not message. They are this client's only: others can still message them. */
export function ClientOptOuts({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const list = useLoad(() => api.optOuts(clientId), [api, clientId]);
  const action = useAction();
  const [message, setMessage] = useState<string | null>(null);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const numbers = String(new FormData(element).get('numbers')).split(/[,\s]+/).filter(Boolean);
    if (numbers.length === 0) return;
    setMessage(null);
    await action.run(async () => {
      const result = await api.addOptOuts(clientId, numbers);
      element.reset();
      list.reload();
      setMessage(`${result.added} added. ${result.invalid} could not be read as numbers.`);
    });
  };

  const remove = async (number: string, source: string) => {
    const warning = source === 'stop_reply' ? ' This customer asked to stop, and Meta requires that to be honoured.' : '';
    if (!window.confirm(`Remove ${number} from opt-outs?${warning} This is recorded in the audit log.`)) return;
    setMessage(null);
    if (await action.run(() => api.removeOptOut(clientId, number))) list.reload();
  };

  return (
    <div className="page-stack">
      <Panel title="Add opt-outs" hint="These numbers are blocked in all of this client's campaigns. A customer replying with a stop word is added by itself.">
        <form className="form-grid" onSubmit={add}>
          <label>
            Numbers, separated by commas or new lines
            <textarea name="numbers" rows={4} required />
          </label>
          <ErrorNote message={action.error} />
          {message && <p className="form-success">{message}</p>}
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={action.busy}>
              Add opt-outs
            </button>
          </div>
        </form>
      </Panel>
      <Panel title="Opted out">
        <ErrorNote message={list.error} />
        {list.data?.items.length === 0 && <p className="empty-state">No numbers have opted out.</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>How</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.number}>
                    <td>{row.number}</td>
                    <td>{SOURCE_WORDS[row.source] ?? row.source}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>
                      <button type="button" className="small-button" disabled={action.busy} onClick={() => void remove(row.number, row.source)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
