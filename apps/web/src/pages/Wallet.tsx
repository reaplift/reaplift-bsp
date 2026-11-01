import { formatPaise, formatPercent, type LedgerRow } from '@reaplift/shared';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { ErrorNote, formatDateTime, Hint, Panel } from '../components/ui';
import { useAction, useLoad } from '../hooks/useLoad';

const KIND_NAMES: Record<LedgerRow['kind'], string> = {
  topup: 'Top-up',
  adjustment: 'Adjustment',
  charge: 'Campaign charge',
  refund: 'Refund',
};
const CATEGORY_NAMES = { MARKETING: 'Marketing', UTILITY: 'Utility', AUTHENTICATION: 'Authentication' } as const;

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const rupees = (paise: number) => (paise / 100).toFixed(2);
const dayStart = (day: string) => `${day}T00:00:00+05:30`;
const dayEnd = (day: string) => `${day}T23:59:59+05:30`;
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date());

export function MoneyTiles({ balancePaise, onHoldPaise, availablePaise }: { balancePaise: number; onHoldPaise: number; availablePaise: number }) {
  return (
    <div className="money-tiles">
      <div className="money-tile">
        <small>
          Current balance <Hint text="All the money in the wallet right now." />
        </small>
        <strong>{formatPaise(balancePaise)}</strong>
      </div>
      <div className="money-tile">
        <small>
          On hold <Hint text="Set aside for scheduled campaigns, so nothing else can spend it. It becomes the charge when the campaign starts, and comes back if it is cancelled." />
        </small>
        <strong>{formatPaise(onHoldPaise)}</strong>
      </div>
      <div className="money-tile main">
        <small>
          Available <Hint text="What can be spent on a new campaign: the current balance less what is on hold." />
        </small>
        <strong>{formatPaise(availablePaise)}</strong>
      </div>
    </div>
  );
}

/** The client's money. Prices include GST; Meta's rate and the markup are never shown here. */
export function Wallet() {
  const { clientId = '' } = useParams();
  const { api } = useAuth();
  const wallet = useLoad(() => api.wallet(clientId), [api, clientId]);
  const prices = useLoad(() => api.prices(clientId), [api, clientId]);
  const [filter, setFilter] = useState<{ kind?: string; from?: string; to?: string }>({});
  const [more, setMore] = useState<LedgerRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const ledger = useLoad(async () => {
    const page = await api.ledger(clientId, filter);
    setMore([]);
    setCursor(page.nextCursor);
    return page;
  }, [api, clientId, filter]);
  const statement = useLoad(() => api.statement(clientId, month), [api, clientId, month]);
  const paging = useAction();
  const download = useAction();

  const rows = [...(ledger.data?.items ?? []), ...more];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '') || undefined;
    const from = value('from');
    const to = value('to');
    setFilter({ kind: value('kind'), from: from && dayStart(from), to: to && dayEnd(to) });
  };

  /** Every row the filter matches, not only those on screen. */
  const downloadCsv = () =>
    download.run(async () => {
      const all: LedgerRow[] = [];
      let next: string | undefined;
      do {
        const page = await api.ledger(clientId, { ...filter, limit: '500', cursor: next });
        all.push(...page.items);
        next = page.nextCursor ?? undefined;
      } while (next);
      const lines = [
        ['Date', 'Type', 'Amount (Rs)', 'Balance after (Rs)', 'Note', 'By'],
        ...all.map((row) => [
          formatDateTime(row.createdAt),
          KIND_NAMES[row.kind],
          rupees(row.amountPaise),
          rupees(row.balanceAfterPaise),
          row.note,
          row.createdBy,
        ]),
      ];
      const blob = new Blob([lines.map((line) => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'wallet-ledger.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    });

  return (
    <div className="page-stack">
      <Panel title="Wallet" hint="Your prepaid balance. Campaigns are charged from it when they start, and failed messages are refunded to it. ReapLift adds money when you pay.">
        <ErrorNote message={wallet.error} />
        {wallet.data && <MoneyTiles {...wallet.data} />}
        {wallet.data && wallet.data.holds.length > 0 && (
          <>
            <h3>On hold for scheduled campaigns</h3>
            <ul>
              {wallet.data.holds.map((hold) => (
                <li key={hold.campaignId}>
                  {hold.campaignName}: {formatPaise(hold.amountPaise)}, starting {formatDateTime(hold.scheduledAt)}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Your prices" hint="What one message costs you, by message type. WhatsApp decides a template's type when it approves it.">
        <ErrorNote message={prices.error} />
        {prices.data && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Message type</th>
                  <th>Price</th>
                  <th>GST</th>
                  <th>You pay per message</th>
                </tr>
              </thead>
              <tbody>
                {prices.data.items.map((price) => (
                  <tr key={price.category}>
                    <td>{CATEGORY_NAMES[price.category]}</td>
                    <td>{price.pricePaise === null ? 'Not set yet' : formatPaise(price.pricePaise)}</td>
                    <td>{formatPercent(price.gstBp)}</td>
                    <td>{price.priceWithGstPaise === null ? '' : formatPaise(price.priceWithGstPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Ledger" hint="Every movement of money in this wallet. Rows can never be changed or deleted; a mistake is put right with a new row.">
        <form className="filter-row" onSubmit={submit}>
          <label>
            Type
            <select name="kind" defaultValue="">
              <option value="">All</option>
              {Object.entries(KIND_NAMES).map(([kind, name]) => (
                <option key={kind} value={kind}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input name="from" type="date" />
          </label>
          <label>
            To
            <input name="to" type="date" />
          </label>
          <button type="submit" className="primary-button">
            Filter
          </button>
          <button type="button" className="small-button" disabled={download.busy} onClick={() => void downloadCsv()}>
            Download CSV
          </button>
        </form>
        <ErrorNote message={ledger.error ?? paging.error ?? download.error} />
        {ledger.data && rows.length === 0 && <p className="empty-state">No movements match.</p>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                  <th>Note</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{KIND_NAMES[row.kind]}</td>
                    <td className={row.amountPaise < 0 ? 'amount-out' : 'amount-in'}>{formatPaise(row.amountPaise)}</td>
                    <td>{formatPaise(row.balanceAfterPaise)}</td>
                    <td>{row.note}</td>
                    <td>{row.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <p>
            <button
              type="button"
              className="small-button"
              disabled={paging.busy}
              onClick={() =>
                void paging.run(async () => {
                  const page = await api.ledger(clientId, { ...filter, cursor });
                  setMore((list) => [...list, ...page.items]);
                  setCursor(page.nextCursor);
                })
              }
            >
              Show more
            </button>
          </p>
        )}
      </Panel>

      <Panel title="Monthly statement" hint="Campaign charges less refunds for the month, split into the amount without GST and the GST. Top-ups are not included, because they are not sales.">
        <div className="filter-row">
          <label>
            Month
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        </div>
        <ErrorNote message={statement.error} />
        {statement.data?.lines.length === 0 && <p className="empty-state">Nothing charged in this month.</p>}
        {statement.data && statement.data.lines.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>GST rate</th>
                  <th>Charged</th>
                  <th>Refunded</th>
                  <th>Net</th>
                  <th>Without GST</th>
                  <th>GST</th>
                </tr>
              </thead>
              <tbody>
                {statement.data.lines.map((line) => (
                  <tr key={line.gstBp}>
                    <td>{formatPercent(line.gstBp)}</td>
                    <td>{formatPaise(line.chargedPaise)}</td>
                    <td>{formatPaise(line.refundedPaise)}</td>
                    <td>{formatPaise(line.netPaise)}</td>
                    <td>{formatPaise(line.taxablePaise)}</td>
                    <td>{formatPaise(line.gstPaise)}</td>
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
