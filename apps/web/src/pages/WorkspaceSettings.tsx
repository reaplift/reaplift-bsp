import type { WaAccount } from '@reaplift/shared';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError } from '../api';
import { errorMessage } from '../api/messages';
import { useAuth } from '../auth/context';
import { ErrorNote, Panel, StatusPill } from '../components/ui';
import { useLoad } from '../hooks/useLoad';
import { loadMetaSdk, metaSignupConfig, runEmbeddedSignup, SignupError, type FbSdk } from '../meta/embeddedSignup';
import { limitName } from './admin/ClientNumber';

const PAYER_NAME: Record<string, string> = {
  reaplift_credit_line: 'ReapLift credit line',
  reaplift_card: 'ReapLift (test number)',
};

/** Meta's Embedded Signup pop-up; off until the panel has ReapLift's Meta app set. */
function ConnectWhatsApp({ clientId, onConnected }: { clientId: string; onConnected: (account: WaAccount) => void }) {
  const { api } = useAuth();
  const [config] = useState(() => metaSignupConfig(import.meta.env));
  const [fb, setFb] = useState<FbSdk | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Loaded before the click, as browsers block a pop-up that opens after a wait.
  useEffect(() => {
    if (!config) return;
    let current = true;
    loadMetaSdk(config).then(
      (sdk) => current && setFb(sdk),
      (err: unknown) => current && setProblem(err instanceof Error ? err.message : errorMessage(err)),
    );
    return () => {
      current = false;
    };
  }, [config]);

  const connect = async () => {
    if (!fb || !config) return;
    setProblem(null);
    setBusy(true);
    try {
      const signup = await runEmbeddedSignup(fb, config);
      onConnected(await api.embeddedSignup(clientId, signup));
    } catch (err) {
      if (err instanceof SignupError) setProblem(err.message);
      else if (err instanceof ApiError && err.code === 'META_REFUSED') {
        setProblem('Meta did not accept the connection. Please try again, or contact ReapLift.');
      } else setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ErrorNote message={problem} />
      <button type="button" className="primary-button" disabled={!fb || busy} onClick={() => void connect()}>
        {busy ? 'Connecting…' : 'Connect WhatsApp'}
      </button>
      {config ? (
        <p className="form-note">Opens Meta's window. Log in to Meta, choose your business and the number to send from.</p>
      ) : (
        <p className="form-note">Connecting through Meta is not available yet. Please contact ReapLift to connect your number.</p>
      )}
    </>
  );
}

/** What a client sees of its own number. Limits and tokens are ReapLift's to change. */
export function WorkspaceSettings() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const { data, error, reload } = useLoad(() => api.waAccounts(clientId), [api, clientId]);
  const [connected, setConnected] = useState<string | null>(null);

  const onConnected = (account: WaAccount) => {
    setConnected(`${account.displayPhone} is connected.`);
    reload();
  };

  return (
    <div className="page-stack">
      <Panel title="WhatsApp number" hint="The number your campaigns are sent from. Your daily limit is set by Meta and rises as you send good-quality messages; it counts different customers messaged in any 24 hours.">
        <ErrorNote message={error} />
        {connected && <p className="form-success">{connected}</p>}
        {data?.items.length === 0 && (
          <>
            <p className="empty-state">No WhatsApp number is connected yet.</p>
            <ConnectWhatsApp clientId={clientId} onConnected={onConnected} />
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
              <div>
                <small>Meta is paid by</small>
                {PAYER_NAME[account.metaPayer] ?? account.metaPayer}
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
