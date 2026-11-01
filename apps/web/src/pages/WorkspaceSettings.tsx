import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { ErrorNote, Panel, StatusPill } from '../components/ui';
import { useLoad } from '../hooks/useLoad';
import { limitName } from './admin/ClientNumber';

/** What a client sees of its own number. Limits and tokens are ReapLift's to change. */
export function WorkspaceSettings() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const { data, error } = useLoad(() => api.waAccounts(clientId), [api, clientId]);

  return (
    <div className="page-stack">
      <Panel title="WhatsApp number" hint="The number your campaigns are sent from. Your daily limit is set by Meta and rises as you send good-quality messages; it counts different customers messaged in any 24 hours.">
        <ErrorNote message={error} />
        {data?.items.length === 0 && (
          <>
            <p className="empty-state">No WhatsApp number is connected yet.</p>
            <button type="button" className="primary-button" disabled>
              Connect WhatsApp
            </button>
            <p className="form-note">Connecting through Meta is not available yet. Please contact ReapLift to connect your number.</p>
          </>
        )}
        {data?.items.map((account) => (
          <div className="number-card" key={account.id}>
            <h3>
              {account.displayPhone} {account.displayName && `(${account.displayName})`} <StatusPill status={account.status} />
            </h3>
            {account.status === 'paused' && (
              <p className="warning-note" role="status">
                Paused: {account.pausedReason ?? 'no reason given'}. Campaigns cannot start, and waiting messages hold until ReapLift resumes it. Please contact ReapLift.
              </p>
            )}
            <div className="fact-list">
              <div>
                <small>Quality</small>
                {account.qualityRating ?? 'Not known yet'}
              </div>
              <div>
                <small>Daily limit</small>
                {limitName(account.messagingLimit)}
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
