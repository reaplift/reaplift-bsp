# M9 demo, end to end

Run on 6 November 2026: the spec's demo in the panel, against PostgreSQL. Chromium driven by `playwright-cli` through the real panel (Vite on `localhost:5173`); real API and scheduler. The same throwaway database as M7's and M8's demos (`reaplift_m7demo`), after them: Northwind's four campaigns of 5 November, Meta's marketing rate 76.00 paise, Northwind's price ₹0.95 + 18% GST = ₹1.13. See [M7's e2e.md](../m7-campaigns/e2e.md) and [M8's](../m8-campaign-controls/e2e.md) for how that data was made.

The worker and receiver were not started: two campaigns still had messages waiting for the daily limit, and a worker would have sent them while the figures were being checked. Nothing in M9 needs them, except sending the alert emails (they stay `pending` below; panel notifications are written straight away).

**Dates.** The spec's example is set on 1 November with October as "last month". This data was all queued on 5 November and the demo ran on 6 November, so the same figures appear under "Yesterday" and "This month", and the month report is November's.

## Step 1: the Dashboard (Asha, `ops@northwind.com`)

```text
Yesterday     12,898   ₹4,483.84 spent
Last 15 days  12,898   ₹4,483.84 spent
This month    12,898   ₹4,483.84 spent
Last month         0       ₹0.00 spent
Day-wise messages: 15 days, 23 Oct to 06 Nov; 05 Nov: 12,898 messages, 0 delivered, 2,000 read, 12 failed
WhatsApp account: 919800000000 | ReapLift Test | GREEN | TIER_2K | active
```

The scheduler's refresh had written `daily_stats` at start-up. The hand count:

```sql
select count(*) as messages, count(*) filter (where status='read') as read, count(*) filter (where status='failed') as failed,
  count(*) filter (where status='blocked') as blocked, count(*) filter (where status='queued') as queued,
  (queued_at at time zone 'Asia/Kolkata')::date as day
from messages group by day;
select -sum(amount_paise) as net_campaign_charge from wallet_ledger where campaign_id is not null;
```

```text
 messages | read | failed | blocked | queued |    day
----------+------+--------+---------+--------+------------
    12898 | 2000 |     12 |    8959 |   1927 | 2026-11-05

 net_campaign_charge
---------------------
              448384
```

12,898 = 2,000 + 12 + 8,959 + 1,927. ₹4,483.84 = charges ₹14,574.74 less refunds ₹10,090.90. The dashboard route answered in 0.27 seconds (on 1 day of data; the 6-month target is not measured).

## Step 2: month-wise summary

Reports, November 2026 (Download CSV and Download Excel gave `SummaryDataMonthWise-2026-11.csv` and `.xlsx`):

```text
Sr No.,Month,Year,User Id,Campaign Name,Total Count,Pending,Failed,Blocked,Sent,Delivered,Not Delivered,DR Not Available,Read Count,Total Unit
1,November,2026,Northwind Labs,Diwali 2026 wave 1,950,0,0,20,918,0,12,0,918,1059.94
2,November,2026,Northwind Labs,Diwali 2026 wave 3,10000,0,0,8918,1082,0,0,0,1082,1222.66
3,November,2026,Northwind Labs,Diwali 2026 wave 2,950,929,0,21,0,0,0,0,0,1073.50
4,November,2026,Northwind Labs,test,998,998,0,0,0,0,0,0,0,1127.74
```

The Excel file, read back with ExcelJS: sheet `SummaryDataMonthWise`, 5 rows, the same headings in the same order. Excel itself was not opened on this machine.

```sql
select k.name, count(*) total, count(*) filter (where m.status in ('queued','sending')) pending,
 count(*) filter (where m.status='blocked') blocked, count(*) filter (where m.status='read') read,
 count(*) filter (where m.status='failed' and m.sent_at is not null) not_delivered,
 (select -sum(amount_paise) from wallet_ledger l where l.campaign_id=k.id) net_paise
from campaigns k join messages m on m.campaign_id=k.id group by k.id, k.name, k.confirmed_at order by k.confirmed_at;
```

```text
        name        | total | pending | blocked | read | not_delivered | net_paise
--------------------+-------+---------+---------+------+---------------+-----------
 Diwali 2026 wave 1 |   950 |       0 |      20 |  918 |            12 |    105994
 Diwali 2026 wave 3 | 10000 |       0 |    8918 | 1082 |             0 |    122266
 Diwali 2026 wave 2 |   950 |     929 |      21 |    0 |             0 |    107350
 test               |   998 |     998 |       0 |    0 |             0 |    112774
```

Every row equals its SQL; the four Total Units add up to the dashboard's ₹4,483.84.

## Step 3: per-number report

Campaign "Diwali 2026 wave 1" chosen in the picker (it lists only confirmed campaigns). Downloads `Reaplift_record1.csv` and `.xlsx` (sheet `Reaplift_record1`, 951 rows with the heading):

```text
sr_no,mobile_no,reason,status,sent_time,delivery_status,delivery_time,read_time,que_time
1,919800001000,,sent,05/11/2026 17:04:34,read,05/11/2026 17:04:36,05/11/2026 17:04:37,05/11/2026 17:04:34
```

950 rows, 950 distinct numbers. Tally of `status,delivery_status`: 918 `sent,read`, 12 `failed,failed`, 20 `blocked`. Reasons: 7 "Message undeliverable", 5 "This message was not delivered to maintain healthy ecosystem engagement.", 20 `opted_out`: M7's figures.

## Step 4: the super admin's view, and the 403

Ravi, Admin, Meta cost and margin, November 2026:

```text
Client          Billed     GST collected  Meta cost  Margin     Numbers (quality, limit)
Bluebird Retail ₹0.00      ₹0.00          ₹0.00      ₹0.00      None
Greenleaf Foods ₹0.00      ₹0.00          ₹0.00      ₹0.00      None
Northwind Labs  ₹3,799.86  ₹683.98        ₹1,520.00  ₹2,279.86  919800000000 (GREEN, TIER_2K)
All clients     ₹3,799.86                 ₹1,520.00  ₹2,279.86

Meta errors by code: Northwind Labs 131026 Message undeliverable 7; 131049 (healthy ecosystem) 5
```

By hand: billed + GST = ₹3,799.86 + ₹683.98 = ₹4,483.84, the ledger's net. Meta cost = 2,000 read messages × 76.00 paise = ₹1,520.00 (`sum(meta_cost_centipaise)` = 15,200,000). Margin = ₹3,799.86 − ₹1,520.00.

As Asha (client), in the browser:

```text
GET /api/admin/meta-view?month=2026-11 -> 403 {"error":"FORBIDDEN","message":"Only a super admin can do this"}
GET /api/admin/meta-invoices           -> 403 (same)
PUT /api/admin/credit-limit            -> 403 (same)
/admin/meta-cost typed in the address  -> back to Northwind's Dashboard; no Meta cost link in her menu
dashboard response                     -> no field mentioning Meta, cost or margin
```

As Meera (staff), over HTTP: the same 403 on `GET /api/admin/meta-view`, `GET` and `POST /api/admin/meta-invoices`.

## Step 6: Meta's invoice

1. Invoice total ₹1,520.00: **"Matches: invoice ₹1,520.00, recorded ₹1,520.00, difference ₹0.00 (0%)."** No notification.
2. Invoice total ₹1,600.00, per account `waba-1, 1600`: **"Mismatch: invoice ₹1,600.00, recorded ₹1,520.00, difference ₹80.00 (5%). Super admins have been notified."** with `waba-1 | ₹1,600.00 | ₹1,520.00 | ₹80.00` as the largest difference.

The panel first refused `waba-1` because it took only digits; the server takes any ID, so the panel now refuses only an ID with spaces (fixed during the run, with its test).

## Credit line (9.8)

Credit limit ₹1,800: "Credit limit set to ₹1,800.00." and "This month: ₹1,520.00 of ₹1,800.00 used (84%)." The scheduler was restarted (the check runs at start and every hour): `{"month":"2026-11","percent":84.44,"msg":"credit line usage is high"}`. Restarted again: the same log line, and no second notification.

```text
             event             |              entity_id               |       email       | channel | status  |                     payload
-------------------------------+--------------------------------------+-------------------+---------+---------+---------------------------------------------------------------
 billing.credit_line_usage     | 2026-11:80                           | ravi@reaplift.com | email   | pending | {"level": 80, "month": "2026-11", "percent": 84}
 billing.credit_line_usage     | 2026-11:80                           | ravi@reaplift.com | panel   | sent    | {"level": 80, "month": "2026-11", "percent": 84}
 billing.meta_invoice_mismatch | 772699e7-cda7-4e89-9f3a-0e817800d2cd | ravi@reaplift.com | email   | pending | {"month": "2026-11", "invoicePaise": 160000, "recordedPaise": 152000}
 billing.meta_invoice_mismatch | 772699e7-cda7-4e89-9f3a-0e817800d2cd | ravi@reaplift.com | panel   | sent    | {"month": "2026-11", "invoicePaise": 160000, "recordedPaise": 152000}

  month  | total_paise |    per_account
---------+-------------+--------------------
 2026-11 |      152000 |
 2026-11 |      160000 | {"waba-1": 160000}
```

Audit: `credit_limit.set` (limitPaise 180000) and two `meta_invoice.entered`, all by `ravi@reaplift.com`. Ledger check at each scheduler start: `{"clients":1,"msg":"ledger check clean"}`.

## Found in the run, for the owner

- **The dashboard counts blocked messages.** "Messages" adds every status, so 8,918 cancelled messages of wave 3 and 41 opted out are in the 12,898; 2,012 were actually sent. The spec's open question ("Dovesoft buckets or a funnel?") defaults to a funnel on the dashboard; the server's count is not one yet.
- **Read is not counted as delivered on the chart.** Its Delivered column follows each message's latest status, so 2,000 read messages show 0 delivered.
- In the per-number report, a message that Meta failed after accepting it has `status` `failed`, not `sent`, though it has a `sent_time`.

## Not covered here

- Real Meta's credit-line invoice and per-account figures (E7); the planted wrong rate is proved by `reports.int.test.ts` only.
- The credit line stop (409 `CREDIT_LIMIT_REACHED` on a new campaign) and the 95% alert: integration tests only.
- The alert emails (no worker ran; E5 for real email).
- A 20,000-row export's memory use, and the one-second dashboard target on 6 months of data.
