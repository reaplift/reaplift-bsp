import { formatPaise, rupeesToPaise, type MetaInvoiceCheck } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/context';
import { ErrorNote, formatDateTime, Panel } from '../../components/ui';
import { useAction, useLoad } from '../../hooks/useLoad';
import { indiaMonth } from '../Reports';

const count = new Intl.NumberFormat('en-IN');

/**
 * "1234567890, 1500.25" per line: Meta's per-account figures, if its invoice gives them. Meta's IDs are
 * digits, but the server takes any ID, so the panel only refuses one with spaces in it.
 */
export function parsePerAccount(text: string): Record<string, number> | null | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  const out: Record<string, number> = {};
  for (const line of lines) {
    const [waba, amount, ...rest] = line.split(',').map((p) => p.trim());
    const paise = rupeesToPaise(amount ?? '');
    if (!waba || !/^\S+$/.test(waba) || paise === null || paise < 0 || rest.length > 0) return null;
    out[waba] = paise;
  }
  return out;
}

function CreditLine({ line, onSaved }: { line: { limitPaise: number; usedPaise: number; usedPercent: number } | null; onSaved: () => void }) {
  const { api } = useAuth();
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const paise = rupeesToPaise(String(new FormData(element).get('limit')));
    setMessage(null);
    if (paise === null || paise <= 0) return setProblem('Enter the limit in rupees, like 500000.');
    setProblem(null);
    if (await action.run(() => api.setCreditLimit(paise))) {
      element.reset();
      setMessage(`Credit limit set to ${formatPaise(paise)}.`);
      onSaved();
    }
  };

  return (
    <Panel
      title="Credit line"
      hint="One Meta credit line pays for every client. Super admins are told at 80% and 95% of the limit, once each a month; a new campaign that would pass it is refused."
    >
      <ErrorNote message={problem ?? action.error} />
      {message && <p className="form-success">{message}</p>}
      {line ? (
        <p>
          This month: <strong>{formatPaise(line.usedPaise)}</strong> of {formatPaise(line.limitPaise)} used (
          <strong>{line.usedPercent}%</strong>).
        </p>
      ) : (
        <p className="empty-state">No credit limit set, so no campaign is refused for it.</p>
      )}
      <form className="filter-row" onSubmit={save}>
        <label>
          Credit limit (₹)
          <input name="limit" inputMode="decimal" required />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Save limit
        </button>
      </form>
    </Panel>
  );
}

function InvoiceCheck({ defaultMonth }: { defaultMonth: string }) {
  const { api } = useAuth();
  const invoices = useLoad(() => api.metaInvoices(), [api]);
  const action = useAction();
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<MetaInvoiceCheck | null>(null);

  const check = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const totalPaise = rupeesToPaise(String(form.get('total')));
    const perAccount = parsePerAccount(String(form.get('perAccount') ?? ''));
    setResult(null);
    if (totalPaise === null || totalPaise < 0) return setProblem("Enter the invoice total in rupees, like 9876.50.");
    if (perAccount === null) return setProblem('Write each account on its own line as: account ID, amount in rupees.');
    setProblem(null);
    let answer: MetaInvoiceCheck | null = null;
    const done = await action.run(async () => {
      answer = await api.addMetaInvoice({ month: String(form.get('month')), totalPaise, ...(perAccount ? { perAccount } : {}) });
    });
    if (done) {
      setResult(answer);
      invoices.reload();
    }
  };

  return (
    <Panel
      title="Check Meta's invoice"
      hint="Enter the total of Meta's monthly credit-line invoice. It is compared with the Meta cost recorded for every delivered, billable message; a difference above 0.5% notifies super admins."
    >
      <ErrorNote message={problem ?? action.error ?? invoices.error} />
      <form className="form-grid" onSubmit={check}>
        <div className="filter-row">
          <label>
            Month
            <input name="month" type="month" defaultValue={defaultMonth} required />
          </label>
          <label>
            Invoice total (₹)
            <input name="total" inputMode="decimal" required />
          </label>
        </div>
        <label>
          Per account, if the invoice lists them (optional): one per line, account ID then amount
          <textarea name="perAccount" rows={3} placeholder="102290129340398, 4520.75" />
        </label>
        <button type="submit" className="primary-button" disabled={action.busy}>
          Check invoice
        </button>
      </form>

      {result && (
        <div className={result.mismatch ? 'form-error' : 'form-success'} role="status">
          <p>
            {result.mismatch ? 'Mismatch' : 'Matches'}: invoice {formatPaise(result.invoicePaise)}, recorded{' '}
            {formatPaise(result.recordedPaise)}, difference {formatPaise(result.differencePaise)} ({result.differencePercent}%).
            {result.mismatch && ' Super admins have been notified. A rate may be wrong, or messages billed in a category we did not expect.'}
          </p>
          {result.largestDifferences.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Invoice</th>
                  <th>Recorded</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {result.largestDifferences.map((d) => (
                  <tr key={d.wabaId}>
                    <td>{d.wabaId}</td>
                    <td className="number-cell">{formatPaise(d.invoicePaise)}</td>
                    <td className="number-cell">{formatPaise(d.recordedPaise)}</td>
                    <td className="number-cell">{formatPaise(d.differencePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {invoices.data && invoices.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <caption>Invoices entered</caption>
            <thead>
              <tr>
                <th>Month</th>
                <th>Total</th>
                <th>Entered</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.month}</td>
                  <td className="number-cell">{formatPaise(i.totalPaise)}</td>
                  <td>{formatDateTime(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Super admin only: what Meta costs ReapLift, what clients were billed, and the margin. */
export function MetaCostPage() {
  const { api } = useAuth();
  const [month, setMonth] = useState(indiaMonth());
  const view = useLoad(() => api.metaView(month), [api, month]);
  const data = view.data;
  const names = new Map((data?.clients ?? []).map((c) => [c.clientId, c.name]));
  const total = (field: 'billedPaise' | 'metaCostPaise' | 'marginPaise') =>
    (data?.clients ?? []).reduce((sum, c) => sum + c[field], 0);

  return (
    <div className="page-stack">
      <div className="filter-row">
        <label>
          Month
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </label>
      </div>
      <ErrorNote message={view.error} />

      <CreditLine line={data?.creditLine ?? null} onSaved={view.reload} />

      <Panel
        title="Cost and margin per client"
        hint="Billed is what clients were charged, less refunds, without GST (GST is not ReapLift's income). Meta cost is from Meta's rate on each delivered, billable message."
      >
        {data && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Billed</th>
                  <th>GST collected</th>
                  <th>Meta cost</th>
                  <th>Margin</th>
                  <th>Numbers (quality, limit)</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.clientId}>
                    <td>{c.name}</td>
                    <td className="number-cell">{formatPaise(c.billedPaise)}</td>
                    <td className="number-cell">{formatPaise(c.gstPaise)}</td>
                    <td className="number-cell">{formatPaise(c.metaCostPaise)}</td>
                    <td className="number-cell">{formatPaise(c.marginPaise)}</td>
                    <td>
                      {c.accounts.length === 0
                        ? 'None'
                        : c.accounts
                            .map((a) => `${a.displayPhone} (${a.qualityRating ?? 'no rating'}, ${a.messagingLimit ?? 'no limit yet'})`)
                            .join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>All clients</th>
                  <th className="number-cell">{formatPaise(total('billedPaise'))}</th>
                  <th />
                  <th className="number-cell">{formatPaise(total('metaCostPaise'))}</th>
                  <th className="number-cell">{formatPaise(total('marginPaise'))}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Meta errors by code" hint="Messages that failed this month, grouped by client and Meta's error code.">
        {data &&
          (data.errors.length === 0 ? (
            <p className="empty-state">No failed messages this month.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Code</th>
                    <th>Reason</th>
                    <th>Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errors.map((e) => (
                    <tr key={`${e.clientId}-${e.code}-${e.reason}`}>
                      <td>{names.get(e.clientId) ?? e.clientId}</td>
                      <td>{e.code ?? '—'}</td>
                      <td>{e.reason ?? '—'}</td>
                      <td className="number-cell">{count.format(e.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </Panel>

      <InvoiceCheck defaultMonth={month} />
    </div>
  );
}
