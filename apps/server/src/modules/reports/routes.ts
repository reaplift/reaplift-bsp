import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { CreditLimit, MetaInvoiceCreate } from '@reaplift/shared';
import { csvLine } from '../../lib/csv.js';
import type { Database } from '../../lib/db.js';
import { writeAudit } from '../admin/audit.js';
import { sendError } from '../auth/scope.js';
import { notify } from '../notifications/notify.js';
import { CREDIT_LIMIT_KEY, monthMetaCost, monthOf, TIME_ZONE } from './stats.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const STREAM_BATCH = 5000;
const INVOICE_TOLERANCE_PERCENT = 0.5;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MONTHLY_COLUMNS = ['Sr No.', 'Month', 'Year', 'User Id', 'Campaign Name', 'Total Count', 'Pending', 'Failed', 'Blocked', 'Sent', 'Delivered', 'Not Delivered', 'DR Not Available', 'Read Count', 'Total Unit'];
const NUMBER_COLUMNS = ['sr_no', 'mobile_no', 'reason', 'status', 'sent_time', 'delivery_status', 'delivery_time', 'read_time', 'que_time'];

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
/** dd/mm/yyyy hh:mm:ss in India time, as Dovesoft's files have it. */
export const reportTime = (at: Date | null) => (at ? DATE_TIME.format(at).replace(', ', ' ') : '');

const rupees = (paise: number) => (paise / 100).toFixed(2);
/** Hundredths of a paisa to whole paise, for a sum that is meant to be read. */
const toPaise = (centipaise: number) => Math.round(centipaise / 100);

const notFound = (reply: FastifyReply) => sendError(reply, 404, 'NOT_FOUND', 'Not found');
const badMonth = (reply: FastifyReply) => sendError(reply, 400, 'INVALID_REQUEST', 'Send month as YYYY-MM');

function monthBefore(month: string) {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

export function registerReportRoutes(app: FastifyInstance, deps: { db: Kysely<Database>; now: () => Date }) {
  const { db, now } = deps;

  // Everything a client or its staff sees comes from these. None selects Meta's cost.
  app.get('/api/clients/:clientId/dashboard', async (req, reply) => {
    const { clientId } = req.scope!;
    const at = now();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);
    const thisMonth = today.slice(0, 7);
    const lastMonth = monthBefore(thisMonth);

    const tile = async (where: ReturnType<typeof sql>) =>
      (
        await sql<{ messages: number; spendPaise: number }>`
          select coalesce(sum(queued + sent + delivered + read + failed + blocked), 0)::int as messages,
            coalesce(sum(client_charge_paise), 0)::bigint as "spendPaise"
          from daily_stats where client_id = ${clientId} and ${where}
        `.execute(db)
      ).rows[0]!;

    const [yesterday, last15, month, previous] = await Promise.all([
      tile(sql`date = ${today}::date - 1`),
      tile(sql`date > ${today}::date - 15 and date <= ${today}::date`),
      tile(sql`to_char(date, 'YYYY-MM') = ${thisMonth}`),
      tile(sql`to_char(date, 'YYYY-MM') = ${lastMonth}`),
    ]);

    const chart = await sql`
      select to_char(d.day, 'YYYY-MM-DD') as date,
        coalesce(sum(s.queued + s.sent + s.delivered + s.read + s.failed + s.blocked), 0)::int as messages,
        coalesce(sum(s.delivered), 0)::int as delivered, coalesce(sum(s.read), 0)::int as read, coalesce(sum(s.failed), 0)::int as failed
      from generate_series(${today}::date - 14, ${today}::date, interval '1 day') as d(day)
      left join daily_stats s on s.client_id = ${clientId} and s.date = d.day::date
      group by d.day order by d.day
    `.execute(db);

    const accounts = await sql`
      select display_phone as "displayPhone", display_name as "displayName", quality_rating as "qualityRating",
        messaging_limit as "messagingLimit", status, paused_reason as "pausedReason"
      from wa_accounts where client_id = ${clientId} order by created_at
    `.execute(db);

    return reply.code(200).send({
      tiles: { yesterday, last15Days: last15, thisMonth: month, lastMonth: previous },
      chart: chart.rows,
      accounts: accounts.rows,
    });
  });

  /** Latest-status buckets, so Total Count = Pending + Failed + Not Delivered + Blocked + Sent, and Sent = Delivered + Read + DR Not Available. */
  app.get('/api/clients/:clientId/reports/monthly', async (req, reply) => {
    const { clientId } = req.scope!;
    const { month, format } = req.query as { month?: string; format?: string };
    if (!month || !MONTH.test(month)) return badMonth(reply);

    const client = (await sql<{ name: string }>`select name from clients where id = ${clientId}`.execute(db)).rows[0]!;
    const rows = (
      await sql<{
        name: string;
        total: number;
        pending: number;
        failed: number;
        blocked: number;
        delivered: number;
        not_delivered: number;
        no_report: number;
        read: number;
        charged: number;
      }>`
        select k.name, count(m.id)::int as total,
          count(*) filter (where m.status in ('queued', 'sending'))::int as pending,
          count(*) filter (where m.status = 'failed' and m.sent_at is null)::int as failed,
          count(*) filter (where m.status = 'failed' and m.sent_at is not null)::int as not_delivered,
          count(*) filter (where m.status = 'blocked')::int as blocked,
          count(*) filter (where m.status = 'delivered')::int as delivered,
          count(*) filter (where m.status = 'sent')::int as no_report,
          count(*) filter (where m.status = 'read')::int as read,
          (select coalesce(-sum(l.amount_paise), 0) from wallet_ledger l where l.client_id = k.client_id and l.campaign_id = k.id)::bigint as charged
        from campaigns k
        join messages m on m.campaign_id = k.id and m.client_id = k.client_id
        where k.client_id = ${clientId} and to_char(k.confirmed_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
        group by k.id, k.client_id, k.name, k.confirmed_at
        order by k.confirmed_at, k.id
      `.execute(db)
    ).rows;

    const [year, number] = month.split('-') as [string, string];
    const table = rows.map((r, i) => [
      i + 1,
      MONTH_NAMES[Number(number) - 1],
      Number(year),
      client.name,
      r.name,
      r.total,
      r.pending,
      r.failed,
      r.blocked,
      r.no_report + r.delivered + r.read,
      r.delivered,
      r.not_delivered,
      r.no_report,
      r.read,
      rupees(r.charged),
    ]);

    if (format === 'csv') {
      return reply
        .code(200)
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="SummaryDataMonthWise-${month}.csv"`)
        .send(csvLine(MONTHLY_COLUMNS) + table.map(csvLine).join(''));
    }
    if (format === 'xlsx') {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet('SummaryDataMonthWise');
      sheet.addRow(MONTHLY_COLUMNS);
      for (const row of table) sheet.addRow(row);
      return reply
        .code(200)
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="SummaryDataMonthWise-${month}.xlsx"`)
        .send(Buffer.from(await book.xlsx.writeBuffer()));
    }
    return reply.code(200).send({
      columns: MONTHLY_COLUMNS,
      items: table.map((row) => Object.fromEntries(MONTHLY_COLUMNS.map((column, i) => [column, row[i]]))),
    });
  });

  /** Reads in batches and streams out, so a 200,000-row campaign does not sit in memory. */
  async function* numberRows(clientId: string, campaignId: string) {
    let after = 0;
    let serial = 0;
    for (;;) {
      const rows = (
        await sql<{
          id: number;
          to_number: string;
          status: string;
          failure_reason: string | null;
          block_reason: string | null;
          sent_at: Date | null;
          delivered_at: Date | null;
          read_at: Date | null;
          queued_at: Date;
        }>`
          select id, to_number, status, failure_reason, block_reason, sent_at, delivered_at, read_at, queued_at
          from messages
          where client_id = ${clientId} and campaign_id = ${campaignId} and id > ${after}
          order by id limit ${STREAM_BATCH}
        `.execute(db)
      ).rows;
      if (rows.length === 0) return;
      for (const r of rows) {
        serial += 1;
        // `status` is how far the send got; `delivery_status` is what Meta last reported.
        const sendStage = r.status === 'failed' || r.status === 'blocked' || r.status === 'queued' || r.status === 'sending' ? r.status : 'sent';
        const delivery = r.status === 'read' || r.status === 'delivered' || r.status === 'failed' ? r.status : '';
        yield [
          serial,
          r.to_number,
          r.failure_reason ?? r.block_reason ?? '',
          sendStage,
          reportTime(r.sent_at),
          delivery,
          reportTime(r.delivered_at),
          reportTime(r.read_at),
          reportTime(r.queued_at),
        ];
      }
      after = rows.at(-1)!.id;
    }
  }

  app.get('/api/clients/:clientId/campaigns/:id/report', async (req, reply) => {
    const { clientId } = req.scope!;
    const { id } = req.params as { id: string };
    const { format } = req.query as { format?: string };
    if (!UUID.test(id)) return notFound(reply);
    const campaign = (
      await sql`select 1 from campaigns where id = ${id} and client_id = ${clientId}`.execute(db)
    ).rows[0];
    if (!campaign) return notFound(reply);

    if (format === 'xlsx') {
      const out = new PassThrough();
      const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: false, useSharedStrings: false });
      const sheet = book.addWorksheet('Reaplift_record1');
      void (async () => {
        try {
          sheet.addRow(NUMBER_COLUMNS).commit();
          for await (const row of numberRows(clientId, id)) sheet.addRow(row).commit();
          await book.commit();
        } catch (err) {
          out.destroy(err as Error);
        }
      })();
      return reply
        .code(200)
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', 'attachment; filename="Reaplift_record1.xlsx"')
        .send(out);
    }

    const lines = async function* () {
      yield csvLine(NUMBER_COLUMNS);
      for await (const row of numberRows(clientId, id)) yield csvLine(row);
    };
    return reply
      .code(200)
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="Reaplift_record1.csv"')
      .send(Readable.from(lines()));
  });

  // Super admin only: Meta's cost and margin.
  app.get('/api/admin/meta-view', async (req, reply) => {
    const { month = monthOf(now()) } = req.query as { month?: string };
    if (!MONTH.test(month)) return badMonth(reply);
    const rows = (
      await sql<{ id: string; name: string; billed: number; cost: number }>`
        select c.id, c.name,
          coalesce((
            select -sum(l.amount_paise) from wallet_ledger l
            where l.client_id = c.id and l.kind in ('charge', 'refund')
              and to_char(l.created_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
          ), 0)::bigint as billed,
          coalesce((
            select sum(m.meta_cost_centipaise) from messages m
            where m.client_id = c.id and to_char(m.delivered_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
          ), 0)::bigint as cost
        from clients c order by c.name
      `.execute(db)
    ).rows;
    const accounts = await sql<{ clientId: string }>`
      select client_id as "clientId", display_phone as "displayPhone", quality_rating as "qualityRating",
        messaging_limit as "messagingLimit", status from wa_accounts order by created_at
    `.execute(db);
    const errors = await sql`
      select client_id as "clientId", meta_error_code as code, failure_reason as reason, count(*)::int as count
      from messages
      where status = 'failed' and to_char(failed_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
      group by client_id, meta_error_code, failure_reason order by count desc limit 500
    `.execute(db);
    const limit = (await sql<{ value: number }>`select value from settings where key = ${CREDIT_LIMIT_KEY}`.execute(db)).rows[0];
    const used = toPaise(await monthMetaCost(db, month));

    return reply.code(200).send({
      month,
      clients: rows.map((r) => ({
        clientId: r.id,
        name: r.name,
        billedPaise: r.billed,
        metaCostPaise: toPaise(r.cost),
        marginPaise: r.billed - toPaise(r.cost),
        accounts: accounts.rows.filter((a) => a.clientId === r.id),
      })),
      errors: errors.rows,
      creditLine: limit
        ? { limitPaise: limit.value, usedPaise: used, usedPercent: Math.floor((used * 100) / limit.value) }
        : null,
    });
  });

  app.put('/api/admin/credit-limit', async (req, reply) => {
    const parsed = CreditLimit.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send limitPaise');
    const at = now();
    await db.transaction().execute(async (trx) => {
      await sql`
        insert into settings (key, value, updated_by, updated_at)
        values (${CREDIT_LIMIT_KEY}, ${JSON.stringify(parsed.data.limitPaise)}::jsonb, ${req.auth!.userId}, ${at})
        on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `.execute(trx);
      await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'credit_limit.set',
        entityType: 'settings',
        entityId: CREDIT_LIMIT_KEY,
        after: parsed.data,
        at,
      });
    });
    return reply.code(200).send(parsed.data);
  });

  app.get('/api/admin/meta-invoices', async (_req, reply) => {
    const rows = await sql`
      select id, month, total_paise as "totalPaise", per_account as "perAccount", created_at as "createdAt"
      from meta_invoices order by month desc, created_at desc limit 500
    `.execute(db);
    return reply.code(200).send({ items: rows.rows, nextCursor: null });
  });

  app.post('/api/admin/meta-invoices', async (req, reply) => {
    const parsed = MetaInvoiceCreate.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_REQUEST', 'Send month as YYYY-MM and totalPaise');
    const { month, totalPaise, perAccount } = parsed.data;
    const recorded = toPaise(await monthMetaCost(db, month));
    const differencePaise = totalPaise - recorded;
    const differencePercent = totalPaise === 0 ? (recorded === 0 ? 0 : 100) : (Math.abs(differencePaise) * 100) / totalPaise;
    const mismatch = differencePercent > INVOICE_TOLERANCE_PERCENT;

    const accounts = perAccount
      ? (
          await sql<{ waba_id: string; cost: number }>`
            select a.waba_id, coalesce(sum(m.meta_cost_centipaise), 0)::bigint as cost
            from wa_accounts a
            left join messages m on m.wa_account_id = a.id and to_char(m.delivered_at at time zone ${TIME_ZONE}, 'YYYY-MM') = ${month}
            group by a.waba_id
          `.execute(db)
        ).rows
      : [];
    const largest = perAccount
      ? Object.entries(perAccount)
          .map(([wabaId, invoicePaise]) => {
            const ours = toPaise(accounts.find((a) => a.waba_id === wabaId)?.cost ?? 0);
            return { wabaId, invoicePaise, recordedPaise: ours, differencePaise: invoicePaise - ours };
          })
          .sort((a, b) => Math.abs(b.differencePaise) - Math.abs(a.differencePaise))
          .slice(0, 10)
      : [];

    const at = now();
    const id = await db.transaction().execute(async (trx) => {
      const row = await sql<{ id: string }>`
        insert into meta_invoices (month, total_paise, per_account, entered_by, created_at)
        values (${month}, ${totalPaise}, ${perAccount ? JSON.stringify(perAccount) : null}::jsonb, ${req.auth!.userId}, ${at})
        returning id
      `.execute(trx);
      const invoiceId = row.rows[0]!.id;
      await writeAudit(trx, {
        userId: req.auth!.userId,
        action: 'meta_invoice.entered',
        entityType: 'meta_invoice',
        entityId: invoiceId,
        after: { month, totalPaise, recorded, differencePaise },
        at,
      });
      if (mismatch) {
        await notify(
          trx,
          'billing.meta_invoice_mismatch',
          { entityId: invoiceId },
          { month, invoicePaise: totalPaise, recordedPaise: recorded },
        );
      }
      return invoiceId;
    });

    return reply.code(201).send({
      id,
      month,
      invoicePaise: totalPaise,
      recordedPaise: recorded,
      differencePaise,
      differencePercent: Math.round(differencePercent * 100) / 100,
      mismatch,
      largestDifferences: largest,
    });
  });
}
