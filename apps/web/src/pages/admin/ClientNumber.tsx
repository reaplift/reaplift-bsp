import type { WaAccount } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { PasswordField } from '../../components/PasswordField';
import { ErrorNote, Panel, StatusPill } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';

const CREDIT_NOT_SHARED = 'credit line not shared';

/** Meta's limit name in words. */
export const limitName = (limit: string | null) => (limit ? limit.replace('TIER_', '') : 'Not known yet');

function NumberCard({ account, onChanged }: { account: WaAccount; onChanged: () => void }) {
  const { api } = useAuth();
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const paused = account.status === 'paused';
  const waitingForCredit = account.pausedReason === CREDIT_NOT_SHARED;

  const saveLimits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const speed = Number(form.get('speed'));
    const dailyText = String(form.get('daily')).trim();
    const daily = dailyText === '' ? null : Number(dailyText);
    setMessage(null);
    if (!Number.isInteger(speed) || speed < 1 || speed > 1000) return setProblem('Speed must be a whole number from 1 to 1000.');
    if (daily !== null && (!Number.isInteger(daily) || daily < 1)) return setProblem('The daily limit must be a whole number above 0, or blank.');
    setProblem(null);
    if (await action.run(() => api.setNumberLimits(account.id, { sendRatePerSec: speed, dailySendLimit: daily }))) {
      onChanged();
      setMessage('Limits saved. They apply from the next round of sending.');
    }
  };

  const replaceToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = String(new FormData(event.currentTarget).get('token'));
    setMessage(null);
    if (await action.run(() => api.replaceToken(account.id, token))) {
      setReplacing(false);
      onChanged();
      setMessage(paused ? 'Token replaced. Resume the number when ready.' : 'Token replaced.');
    }
  };

  return (
    <div className="number-card">
      <h3>
        {account.displayPhone} {account.displayName && `(${account.displayName})`} <StatusPill status={account.status} />
      </h3>
      {paused && (
        <p className="warning-note" role="status">
          Paused: {account.pausedReason ?? 'no reason given'}. Nothing is sent until this is resolved.
        </p>
      )}
      <ErrorNote message={problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      <div className="fact-list">
        <div>
          <small>Quality</small>
          {account.qualityRating ?? 'Not known yet'}
        </div>
        <div>
          <small>Meta's daily limit, in customers</small>
          {limitName(account.messagingLimit)}
        </div>
        <div>
          <small>Paid by</small>
          {account.metaPayer.endsWith('credit_line') ? 'ReapLift credit line' : 'ReapLift card'}
        </div>
        <div>
          <small>Connected</small>
          {account.onboardedVia === 'embedded_signup' ? 'By the client, through Meta' : 'Manually'}
        </div>
      </div>
      <form className="filter-row" onSubmit={saveLimits} key={`${account.sendRatePerSec}-${account.dailySendLimit}`}>
        <label>
          Speed (messages a second)
          <input name="speed" inputMode="numeric" defaultValue={account.sendRatePerSec} required />
        </label>
        <label>
          Our daily limit, in customers (blank: only Meta's)
          <input name="daily" inputMode="numeric" defaultValue={account.dailySendLimit ?? ''} />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Save limits
        </button>
      </form>
      <div className="row-actions">
        {paused && !waitingForCredit && (
          <button
            type="button"
            className="small-button"
            disabled={action.busy}
            onClick={async () => {
              if (await action.run(() => api.resumeNumber(account.id))) {
                onChanged();
                setMessage('Resumed. Waiting messages carry on sending.');
              }
            }}
          >
            Resume number
          </button>
        )}
        {waitingForCredit && (
          <button
            type="button"
            className="small-button"
            disabled={action.busy}
            onClick={async () => {
              if (await action.run(() => api.shareCredit(account.id))) {
                onChanged();
                setMessage('Credit line shared. The number is active.');
              }
            }}
          >
            Share credit line
          </button>
        )}
        <button type="button" className="small-button" onClick={() => setReplacing((value) => !value)}>
          Replace token
        </button>
      </div>
      {replacing && (
        <form className="filter-row" onSubmit={replaceToken}>
          <PasswordField label="New Meta token" name="token" autoComplete="off" hint="Checked with Meta before it is saved. It is stored encrypted and never shown again." />
          <button type="submit" className="primary-button" disabled={action.busy}>
            Save token
          </button>
        </form>
      )}
    </div>
  );
}

export function ClientNumber({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const accounts = useLoad(() => api.waAccounts(clientId), [api, clientId]);
  const connect = useAction();
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const done = await connect.run(() =>
      api.connectNumber(clientId, {
        wabaId: String(form.get('wabaId')).trim(),
        phoneNumberId: String(form.get('phoneNumberId')).trim(),
        token: String(form.get('token')).trim(),
      }),
    );
    if (done) {
      element.reset();
      accounts.reload();
      setMessage('Number connected, and its templates copied from Meta.');
    }
  };

  return (
    <div className="page-stack">
      <Panel
        title="WhatsApp number"
        hint="The number this client sends from. Speed and our daily limit are set here; Meta's limit comes from Meta. A number pauses by itself if Meta's quality drops to Low or a token stops working, and only a super admin can resume it."
      >
        <ErrorNote message={accounts.error} />
        {message && <p className="form-success">{message}</p>}
        {accounts.data?.items.length === 0 && <p className="empty-state">No number connected yet.</p>}
        {accounts.data?.items.map((account) => <NumberCard key={account.id} account={account} onChanged={accounts.reload} />)}
      </Panel>

      <Panel
        title="Connect a number manually"
        hint="For ReapLift's own test numbers and support. Clients connect their own numbers through Meta's sign-up, from Settings in their workspace."
      >
        <form className="form-grid" onSubmit={submit}>
          <label>
            WhatsApp account ID
            <input name="wabaId" required />
          </label>
          <label>
            Phone number ID
            <input name="phoneNumberId" required />
          </label>
          <PasswordField label="Meta token" name="token" autoComplete="off" hint="Checked with Meta before anything is saved. It is stored encrypted and never shown again." />
          <ErrorNote message={connect.error} />
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={connect.busy}>
              Connect number
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
