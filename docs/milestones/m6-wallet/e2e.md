# M6 demo, end to end

Run on 5 November 2026, the spec's demo: the worked example's steps 1 to 6 in the panel against PostgreSQL. Chrome, driven by hand through the real panel; real API, worker and scheduler; the fake email provider (E5 is not done). Nothing was set through a route or SQL except the planted mismatch in step 6 and the refused changes, which are database checks.

## Setup

A throwaway database, so the demo's ledger rows (which cannot be deleted) stay out of the development one.

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m6demo"
export DATABASE_URL=postgres://reaplift:<password>@localhost:5432/reaplift_m6demo
pnpm migrate                                   # 17 applied
pnpm --filter @reaplift/server cli seed-dev    # Seeded 3 clients and 4 users
pnpm dev                                       # API and panel
cd apps/server && MODE=worker npx tsx --env-file-if-exists=../../.env src/main.ts
cd apps/server && MODE=scheduler npx tsx --env-file-if-exists=../../.env src/main.ts
```

Logs at start: `worker started` with `"emailProvider":"fake"`; `scheduler started`, then `ledger check clean` with `"clients":0`.

## Step 1: Meta rates, markup, alert (Ravi, super admin)

Admin Settings, Meta rates: Marketing 86.31, Utility 11.50, Authentication 11.50 paise, +91, from 05 Nov 2026. Default markup left at 25%.

Northwind's Money and prices tab, before its own markup (25% default):

```text
Marketing      86.31 paise  ₹1.08  18%  ₹1.28
Utility        11.50 paise  ₹0.15  18%  ₹0.18
Authentication 11.50 paise  ₹0.15  18%  ₹0.18
```

After "This client's own markup" 20% for each type, the page said "Prices saved. They apply to campaigns confirmed from now on." and showed:

```text
Marketing      86.31 paise  ₹1.04  18%  ₹1.23     (86.31 × 1.20 = 103.57, rounded up to 104)
Utility        11.50 paise  ₹0.14  18%  ₹0.17     (11.50 × 1.20 = 13.80, rounded up to 14)
Authentication 11.50 paise  ₹0.14  18%  ₹0.17
```

Low-balance alert set to 500: "Low-balance alert set to ₹500.00."

## Steps 2 and 3: top-up and correcting a duplicate

Top-up ₹10,000 "NEFT UTR 4471" ("Added ₹10,000.00."), then ₹1,000 "NEFT UTR 4502" twice, then a correction of −1000 "duplicate top-up 5 Nov" ("Corrected by -₹1,000.00."). Balance and Available: ₹11,000.00.

## Step 4: low-balance alert, once, then re-armed

Corrections −10600 "alert test" (₹400.00) and −50 "alert test, second drop" (₹350.00). Then, to show the re-arm, top-up 1000 "re-arm test" (₹1,350.00) and correction −1000 "re-arm test, drop again" (₹350.00).

```sql
select event, channel, count(*) from notifications where event like 'wallet.%' group by event, channel order by 1, 2;
```

```text
       event        | channel | count
--------------------+---------+-------
 wallet.low_balance | email   |     6
 wallet.low_balance | panel   |     6
 wallet.topped_up   | email   |     8
 wallet.topped_up   | panel   |     8
```

Low balance: `ops@northwind.com`, `meera@reaplift.com` and `ravi@reaplift.com`, one email and one panel row each for the first drop below ₹500 and again after the re-arm; none for the −₹50. Top-ups: four top-ups × (`ops@northwind.com`, `meera@reaplift.com`); the super admin is not a recipient. Every email row is `sent` through the fake provider.

The ledger:

```sql
select l.kind, l.amount_paise, l.balance_after_paise, l.note, u.email as by_user
from wallet_ledger l join clients c on c.id = l.client_id left join users u on u.id = l.created_by
where c.name = 'Northwind Labs' order by l.created_at;
```

```text
    kind    | amount_paise | balance_after_paise |          note           |      by_user
------------+--------------+---------------------+-------------------------+-------------------
 topup      |      1000000 |             1000000 | NEFT UTR 4471           | ravi@reaplift.com
 topup      |       100000 |             1100000 | NEFT UTR 4502           | ravi@reaplift.com
 topup      |       100000 |             1200000 | NEFT UTR 4502           | ravi@reaplift.com
 adjustment |      -100000 |             1100000 | duplicate top-up 5 Nov  | ravi@reaplift.com
 adjustment |     -1060000 |               40000 | alert test              | ravi@reaplift.com
 adjustment |        -5000 |               35000 | alert test, second drop | ravi@reaplift.com
 topup      |       100000 |              135000 | re-arm test             | ravi@reaplift.com
 adjustment |      -100000 |               35000 | re-arm test, drop again | ravi@reaplift.com
```

Sum of rows 35000 = latest balance 35000.

The database refuses changing or deleting a row:

```text
update wallet_ledger set amount_paise = 99999999 where note = 'NEFT UTR 4471';
ERROR:  wallet_ledger rows cannot be changed or deleted
delete from wallet_ledger where note = 'alert test';
ERROR:  wallet_ledger rows cannot be changed or deleted
```

## Step 5: what the client sees (`ops@northwind.com`)

Wallet, Balance: current ₹350.00, on hold ₹0.00, available ₹350.00; the bell shows 6 (four top-ups, two low-balance alerts). Prices: Marketing ₹1.04 + 18% = ₹1.23, Utility and Authentication ₹0.14 + 18% = ₹0.17, with no Meta rate or markup. Ledger: the eight rows above, newest first, with notes and "Ravi".

The same session calling the server directly:

```text
POST /api/admin/clients/NORTHWIND/wallet/topups       -> 403 FORBIDDEN "Only a super admin can do this"
POST /api/admin/clients/NORTHWIND/wallet/adjustments  -> 403 FORBIDDEN
GET  /api/admin/meta-rates                            -> 403 FORBIDDEN
GET  /api/admin/clients/NORTHWIND/pricing             -> 403 FORBIDDEN
GET  /api/clients/GREENLEAF/wallet                    -> 404 NOT_FOUND
GET  /api/clients/NORTHWIND/prices                    -> 200 {"items":[{"category":"MARKETING","pricePaise":104,"gstBp":1800,"priceWithGstPaise":123}, ...]}
```

## Restart

API, panel, worker and scheduler stopped and started again on the same database. The scheduler logged `ledger check clean` with `"clients":1`. The client, still logged in, reloaded the Wallet and saw ₹350.00 and 6 notifications.

## Step 6: the ledger check finds a planted mismatch

A row written past the app, so the sum no longer equals the balance:

```sql
insert into wallet_ledger (client_id, kind, amount_paise, balance_after_paise, note)
select id, 'adjustment', 100, 35000, 'PLANTED MISMATCH (demo only)' from clients where name = 'Northwind Labs';
```

Scheduler restarted (the check runs at start and every 24 hours):

```text
{"level":50,"clients":["63ad0f65-3c05-45ac-8d9c-087e6afdf7c5"],"campaigns":[],"msg":"ledger check found a mismatch"}
```

```text
             event              |       email       |    role     | channel | status
--------------------------------+-------------------+-------------+---------+--------
 wallet.reconciliation_mismatch | ravi@reaplift.com | super_admin | email   | sent
```

## Not covered here

- Charging and refunding a campaign from this wallet is M7's flow; the money on hold and the charge with GST were shown in the browser on 2 November ([test-evidence.md](test-evidence.md)).
- Real email (E5): every email went through the fake provider.
- The switch for sent but undelivered messages stays locked (P12).
