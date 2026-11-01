import { formatCentipaise, formatPaise, formatPercent, paiseToCentipaise, percentToBp } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';
import { CATEGORIES, ChargeSwitches } from './ClientMoney';

const startOfDay = (day: string) => new Date(`${day}T00:00:00+05:30`).toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const thisMonth = () => today().slice(0, 7);

function GstSettings() {
  const { api } = useAuth();
  const rates = useLoad(() => api.gstRates(), [api]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const report = useLoad(() => api.gstReport(month), [api, month]);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const rateBp = percentToBp(String(form.get('rate')));
    setMessage(null);
    if (rateBp === null || rateBp > 5000) return setProblem('Enter a rate from 0 to 50, like 18 or 18.5.');
    setProblem(null);
    const done = await action.run(() => api.addGstRate({ rateBp, validFrom: startOfDay(String(form.get('from'))) }));
    if (done) {
      element.reset();
      rates.reload();
      setMessage('GST rate saved. Campaigns already confirmed keep the rate they were charged at.');
    }
  };

  return (
    <Panel title="GST" hint="Added to every price clients pay. A new rate applies from its date; campaigns already confirmed keep theirs. How GST is timed is still for the accountant to confirm (G1 in the open questions).">
      <ErrorNote message={rates.error ?? problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {rates.data && (
        <p>
          Current rate: <strong>{formatPercent(rates.data.currentBp)}</strong>
        </p>
      )}
      <form className="filter-row" onSubmit={add}>
        <label>
          New rate (%)
          <input name="rate" inputMode="decimal" placeholder="18" required />
        </label>
        <label>
          From
          <input name="from" type="date" defaultValue={today()} required />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Save GST rate
        </button>
      </form>
      {rates.data && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Rate</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {rates.data.items.map((rate) => (
                <tr key={rate.id}>
                  <td>{formatPercent(rate.rateBp)}</td>
                  <td>{formatDateTime(rate.validFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>GST report for the accountant</h3>
      <div className="filter-row">
        <label>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      <ErrorNote message={report.error} />
      {report.data?.lines.length === 0 && <p className="empty-state">Nothing charged in this month.</p>}
      {report.data && report.data.lines.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>GST rate</th>
                <th>Net charged</th>
                <th>Without GST</th>
                <th>GST</th>
              </tr>
            </thead>
            <tbody>
              {report.data.lines.map((line) => (
                <tr key={`${line.clientName}-${line.gstBp}`}>
                  <td>{line.clientName}</td>
                  <td>{formatPercent(line.gstBp)}</td>
                  <td>{formatPaise(line.netPaise)}</td>
                  <td>{formatPaise(line.taxablePaise)}</td>
                  <td>{formatPaise(line.gstPaise)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                <td />
                <td>{formatPaise(report.data.totals.netPaise)}</td>
                <td>{formatPaise(report.data.totals.taxablePaise)}</td>
                <td>{formatPaise(report.data.totals.gstPaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function MetaRates() {
  const { api } = useAuth();
  const rates = useLoad(() => api.metaRates(), [api]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const rateCentipaise = paiseToCentipaise(String(form.get('rate')));
    setMessage(null);
    if (rateCentipaise === null) return setProblem('Enter the rate in paise, with at most two decimals, like 86.31.');
    setProblem(null);
    const done = await action.run(() =>
      api.addMetaRate({
        category: String(form.get('category')),
        countryCallingCode: '91',
        rateCentipaise,
        validFrom: startOfDay(String(form.get('from'))),
      }),
    );
    if (done) {
      element.reset();
      rates.reload();
      setMessage('Meta rate saved. Clients on a markup follow it from its date.');
    }
  };

  return (
    <Panel title="Meta rates" hint="What Meta charges ReapLift per message, from Meta's rate card, in paise. Markups are worked out from these, and margin reports use them. Clients never see them.">
      <ErrorNote message={rates.error ?? problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      <form className="filter-row" onSubmit={add}>
        <label>
          Message type
          <select name="category" defaultValue="MARKETING">
            {CATEGORIES.map((c) => (
              <option key={c.api} value={c.api}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rate (paise)
          <input name="rate" inputMode="decimal" placeholder="86.31" required />
        </label>
        <label>
          From
          <input name="from" type="date" defaultValue={today()} required />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Add rate
        </button>
      </form>
      {rates.data?.items.length === 0 && (
        <p className="warning-note">No Meta rates yet, so clients on a markup have no price and cannot start campaigns.</p>
      )}
      {rates.data && rates.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Message type</th>
                <th>Country</th>
                <th>Rate</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {rates.data.items.map((rate) => (
                <tr key={rate.id}>
                  <td>{CATEGORIES.find((c) => c.api === rate.category)?.name}</td>
                  <td>+{rate.countryCallingCode}</td>
                  <td>{formatCentipaise(rate.rateCentipaise)}</td>
                  <td>{formatDateTime(rate.validFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function DefaultMarkup() {
  const { api } = useAuth();
  const pricing = useLoad(() => api.defaultPricing(), [api]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = CATEGORIES.map((c) => percentToBp(String(form.get(c.key))));
    setMessage(null);
    if (values.some((v) => v === null)) return setProblem('Fill in all three as percentages, like 25 or 22.5.');
    setProblem(null);
    const markupBp = { marketing: values[0]!, utility: values[1]!, authentication: values[2]! };
    if (await action.run(() => api.setDefaultPricing(markupBp))) {
      pricing.reload();
      setMessage('Default markup saved. It applies to every client without its own prices.');
    }
  };

  return (
    <Panel title="Default markup" hint="Added on top of Meta's rate for every client that has no prices of its own. Set a client's own prices on its page.">
      <ErrorNote message={pricing.error ?? problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {pricing.data && (
        <form className="filter-row" onSubmit={save} key={JSON.stringify(pricing.data.markupBp)}>
          {CATEGORIES.map((category) => (
            <label key={category.key}>
              {category.name} (%)
              <input name={category.key} inputMode="decimal" defaultValue={pricing.data!.markupBp[category.key] / 100} required />
            </label>
          ))}
          <button type="submit" className="primary-button" disabled={action.busy}>
            Save default
          </button>
        </form>
      )}
    </Panel>
  );
}

function ChargingDefaults() {
  const { api } = useAuth();
  const policy = useLoad(() => api.chargePolicy(), [api]);
  return (
    <Panel title="Charging switches" hint="Which outcomes clients pay for, for all clients. A client's page can set its own. These follow the design's charging policy until ReapLift decides otherwise.">
      <ErrorNote message={policy.error} />
      {policy.data && (
        <ChargeSwitches
          policy={policy.data.policy}
          onToggle={(outcome, charged) => api.setChargePolicy({ outcome, charged }).then(policy.reload)}
        />
      )}
    </Panel>
  );
}

/** ReapLift-wide controls. Each client's own prices and money are on its page. */
export function SettingsPage() {
  return (
    <div className="page-stack">
      <GstSettings />
      <MetaRates />
      <DefaultMarkup />
      <ChargingDefaults />
    </div>
  );
}
