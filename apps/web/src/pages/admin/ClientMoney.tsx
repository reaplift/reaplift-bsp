import { formatCentipaise, formatPaise, formatPercent, percentToBp, rupeesToPaise, type ClientPricingView } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';
import { MoneyTiles } from '../Wallet';

const BAD_AMOUNT = 'Enter rupees as a number, with at most two decimals, like 1000 or 1000.50.';
export const CATEGORIES = [
  { key: 'marketing', name: 'Marketing', api: 'MARKETING' },
  { key: 'utility', name: 'Utility', api: 'UTILITY' },
  { key: 'authentication', name: 'Authentication', api: 'AUTHENTICATION' },
] as const;

/** Balance, top-ups, corrections and the low-balance alert. */
export function ClientMoney({ clientId, onChanged }: { clientId: string; onChanged: () => void }) {
  const { api } = useAuth();
  const wallet = useLoad(() => api.wallet(clientId), [api, clientId]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const after = (text: string) => {
    wallet.reload();
    onChanged();
    setMessage(text);
  };

  const topUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const amountPaise = rupeesToPaise(String(form.get('amount')));
    setMessage(null);
    if (amountPaise === null || amountPaise <= 0) return setProblem('A top-up must be more than zero. ' + BAD_AMOUNT);
    setProblem(null);
    const note = String(form.get('note')).trim();
    if (await action.run(() => api.topUp(clientId, { amountPaise, ...(note ? { note } : {}) }))) {
      element.reset();
      after(`Added ${formatPaise(amountPaise)}.`);
    }
  };

  const adjust = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const amountPaise = rupeesToPaise(String(form.get('amount')));
    setMessage(null);
    if (amountPaise === null || amountPaise === 0) return setProblem('A correction cannot be zero. ' + BAD_AMOUNT);
    setProblem(null);
    if (await action.run(() => api.adjust(clientId, { amountPaise, note: String(form.get('note')) }))) {
      element.reset();
      after(`Corrected by ${formatPaise(amountPaise)}.`);
    }
  };

  const saveAlert = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('alert')).trim();
    const alertPaise = text === '' ? null : rupeesToPaise(text);
    setMessage(null);
    if (text !== '' && (alertPaise === null || alertPaise < 0)) return setProblem(BAD_AMOUNT);
    setProblem(null);
    if (await action.run(() => api.setLowBalanceAlert(clientId, alertPaise))) {
      after(alertPaise === null ? 'Low-balance alert is off.' : `Low-balance alert set to ${formatPaise(alertPaise)}.`);
    }
  };

  return (
    <Panel title="Money" hint="This client's prepaid wallet. Every change here adds a permanent ledger row and an audit row; rows are never edited.">
      <ErrorNote message={wallet.error ?? problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {wallet.data && <MoneyTiles {...wallet.data} />}

      <h3>Top up</h3>
      <form className="filter-row" onSubmit={topUp}>
        <label>
          Amount (₹)
          <input name="amount" inputMode="decimal" placeholder="10000" required />
        </label>
        <label>
          Note
          <input name="note" placeholder="NEFT UTR 4471" />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Add money
        </button>
      </form>

      <h3>Correction</h3>
      <form className="filter-row" onSubmit={adjust}>
        <label>
          Amount (₹; use a minus to take money away)
          <input name="amount" inputMode="decimal" placeholder="-1000" required />
        </label>
        <label>
          Reason (required)
          <input name="note" placeholder="duplicate top-up 29 Oct" required />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Save correction
        </button>
      </form>

      <h3>Low-balance alert</h3>
      {wallet.data && (
        <form className="filter-row" onSubmit={saveAlert} key={wallet.data.lowBalanceAlertPaise ?? 'none'}>
          <label>
            Alert below (₹; leave blank for no alert)
            <input
              name="alert"
              inputMode="decimal"
              defaultValue={wallet.data.lowBalanceAlertPaise === null ? '' : (wallet.data.lowBalanceAlertPaise / 100).toFixed(2)}
            />
          </label>
          <button type="submit" className="primary-button" disabled={action.busy}>
            Save alert
          </button>
        </form>
      )}
    </Panel>
  );
}

const initialValue = (view: ClientPricingView['pricing'], mode: 'markup' | 'fixed', key: (typeof CATEGORIES)[number]['key']) => {
  const suffix = key.charAt(0).toUpperCase() + key.slice(1);
  if (mode === 'markup') {
    const bp = view[`markup${suffix}Bp` as 'markupMarketingBp'];
    return bp === null || bp === undefined ? '' : String(bp / 100);
  }
  const paise = view[`fixed${suffix}Paise` as 'fixedMarketingPaise'];
  return paise === null || paise === undefined ? '' : (paise / 100).toFixed(2);
};

/** What this client pays per message: the default, its own markup, or fixed prices. */
export function ClientPrices({ clientId }: { clientId: string }) {
  const { api } = useAuth();
  const view = useLoad(() => api.clientPricing(clientId), [api, clientId]);
  const policy = useLoad(() => api.chargePolicy(clientId), [api, clientId]);
  const action = useAction();
  const [mode, setMode] = useState<'default' | 'markup' | 'fixed' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const current = mode ?? view.data?.pricing.mode ?? 'default';

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    const read = (parse: (text: string) => number | null) => {
      const values = CATEGORIES.map((c) => parse(String(form.get(c.key) ?? '')));
      if (values.some((v) => v === null || v < 0)) return null;
      return { marketing: values[0]!, utility: values[1]!, authentication: values[2]! };
    };
    let body: Parameters<typeof api.setClientPricing>[1] = { mode: 'default' };
    if (current !== 'default') {
      const values = read(current === 'markup' ? percentToBp : rupeesToPaise);
      if (!values) return setProblem('Fill in all three message types, as numbers with at most two decimals.');
      body = current === 'markup' ? { mode: 'markup', markupBp: values } : { mode: 'fixed', fixedPaise: values };
    }
    setProblem(null);
    if (await action.run(() => api.setClientPricing(clientId, body))) {
      view.reload();
      setMessage('Prices saved. They apply to campaigns confirmed from now on.');
    }
  };

  const belowCost = view.data?.prices.filter((price) => price.belowCost) ?? [];
  const seedKey = view.data ? `${current}-${JSON.stringify(view.data.pricing)}` : 'loading';

  return (
    <Panel title="Prices" hint="What this client pays per message, before GST. A markup follows Meta's rate; a fixed price does not, so it can fall below cost if Meta raises its rate. This client never sees Meta's rate or the markup.">
      <ErrorNote message={view.error ?? problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {belowCost.length > 0 && (
        <p className="warning-note" role="alert">
          Below Meta's rate, so ReapLift loses money on each message:{' '}
          {belowCost.map((price) => `${price.category.toLowerCase()} (${formatPaise(price.pricePaise ?? 0)})`).join(', ')}.
        </p>
      )}
      {view.data && (
        <form onSubmit={save} key={seedKey}>
          <div className="filter-row">
            <label>
              Price model
              <select value={current} onChange={(e) => setMode(e.target.value as typeof current)}>
                <option value="default">ReapLift's default markup</option>
                <option value="markup">This client's own markup (%)</option>
                <option value="fixed">Fixed price (₹ per message)</option>
              </select>
            </label>
            {current !== 'default' &&
              CATEGORIES.map((category) => (
                <label key={category.key}>
                  {category.name} {current === 'markup' ? '(%)' : '(₹)'}
                  <input
                    name={category.key}
                    inputMode="decimal"
                    defaultValue={view.data!.pricing.mode === current ? initialValue(view.data!.pricing, current, category.key) : ''}
                    required
                  />
                </label>
              ))}
            <button type="submit" className="primary-button" disabled={action.busy}>
              Save prices
            </button>
          </div>
        </form>
      )}
      {view.data && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Message type</th>
                <th>Meta's rate</th>
                <th>Client's price</th>
                <th>GST</th>
                <th>Client pays</th>
              </tr>
            </thead>
            <tbody>
              {view.data.prices.map((price) => (
                <tr key={price.category}>
                  <td>{CATEGORIES.find((c) => c.api === price.category)?.name}</td>
                  <td>{price.metaRateCentipaise === null ? 'Not entered' : formatCentipaise(price.metaRateCentipaise)}</td>
                  <td>{price.pricePaise === null ? 'No price yet' : formatPaise(price.pricePaise)}</td>
                  <td>{formatPercent(price.gstBp)}</td>
                  <td>{price.priceWithGstPaise === null ? '' : formatPaise(price.priceWithGstPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {policy.data && (
        <>
          <h3>Charging switches for this client</h3>
          <ChargeSwitches
            policy={policy.data.policy}
            onToggle={(outcome, charged) => api.setChargePolicy({ clientId, outcome, charged }).then(policy.reload)}
          />
        </>
      )}
    </Panel>
  );
}

const OUTCOMES: Array<{ key: string; name: string; locked?: string }> = [
  { key: 'delivered', name: 'Sent or delivered: charged at confirm' },
  { key: 'blocked', name: 'Blocked by rules or opt-out' },
  { key: 'failed', name: 'Failed at Meta (off means refunded)' },
  { key: 'invalid', name: 'Invalid numbers' },
  { key: 'duplicate', name: 'Duplicate numbers' },
  { key: 'sent_not_delivered', name: 'Sent but never delivered', locked: 'Always charged for now; turning this off is not built (P12).' },
];

/** One switch per outcome. Used for all clients in Settings, and for one client here. */
export function ChargeSwitches({
  policy,
  onToggle,
}: {
  policy: Partial<Record<string, boolean>>;
  onToggle: (outcome: string, charged: boolean) => Promise<unknown>;
}) {
  const action = useAction();
  return (
    <div>
      <ErrorNote message={action.error} />
      {OUTCOMES.map((outcome) => (
        <label key={outcome.key} className="check-row">
          <input
            type="checkbox"
            checked={Boolean(policy[outcome.key])}
            disabled={action.busy || Boolean(outcome.locked)}
            onChange={(e) => void action.run(() => onToggle(outcome.key, e.target.checked))}
          />
          {outcome.name}
          {outcome.locked && <span className="form-note"> {outcome.locked}</span>}
        </label>
      ))}
    </div>
  );
}
