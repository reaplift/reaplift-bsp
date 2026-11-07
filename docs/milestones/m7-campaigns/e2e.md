# M7 demo, end to end

Run on 5 November 2026: the worked example at its real size (1,000 rows), in the panel, against PostgreSQL, with a fake Meta server. Chrome, driven by hand through the real panel; real API, worker, receiver and scheduler. **This is the fake-Meta half of the spec's demo.** ReapLift's test number, three team phones and a STOP from a real phone still need E1 and E2, and are not done.

## Setup

A throwaway database (`reaplift_m7demo`, migrated and seeded with `seed-dev`). Every process ran with `META_API_BASE_URL=http://127.0.0.1:4010` and a test `META_APP_SECRET`, so webhooks pass the signature check.

The fake Meta server was the repo's `FakeMeta` (`apps/server/test/support/fake-meta.ts`) with three behaviours added for this run, kept outside the repo:

- a submitted template is approved by a signed `message_template_status_update` webhook three seconds later;
- each accepted send gets signed `sent`, `delivered` and `read` webhooks one second apart, except twelve chosen numbers, which get `sent` then `failed`: seven with 131026 ("Message undeliverable") and five with 131049 (Meta's per-person marketing limit);
- a separate script posts an inbound text "STOP" to `phone-1`, as Meta delivers a customer's reply.

The audience file, `diwali_customers.csv`, has 1,000 rows with columns `Name`, `Mobile`, `City`: 950 valid numbers written three ways (`+91 98000 01000`, `09800001007`, `9800001014`), 25 ten-digit numbers starting with 2 (not mobile), 8 too short, 4 spoiled by Excel (`9.19810E+11`), 3 from the UK (`+44…`), and 10 repeats of valid numbers written as `91…`. The first row is Rahul. Run through the server's own `cleanRows` before the demo: valid 950, not_mobile 25, too_short 8, scientific_notation 4, wrong_country 3, duplicate 10.

**Prices include GST.** The spec's example predates GST (M6 6.1a), so Northwind was given a fixed marketing price of ₹0.95 and pays ₹1.13 with 18% GST (95 × 1.18 = 112.1, rounded up). Every amount below is the spec's figure at ₹1.13 instead of ₹0.95.

## Ravi (super admin) sets the starting point

- Admin Settings, Meta rates: marketing 76.00 paise. "Meta rate saved."
- Northwind, Money and prices: top-up ₹2,000 "NEFT UTR 5120" ("Added ₹2,000.00."); fixed price marketing ₹0.95, shown as `Marketing 76.00 paise ₹0.95 18% ₹1.13`.
- Northwind, Opt-outs: 20 of the file's numbers. "20 added. 0 could not be read as numbers."
- Northwind, WhatsApp number: connected manually to the fake server's `phone-1`. "Number connected, and its templates copied from Meta." Active, quality GREEN, limit 2K, speed 50 a second.

## Meera (staff) makes the template

`diwali_offer_2026`, MARKETING, body as in the spec: "Hi {{1}}, flat 20% off till Sunday. Use code {{2}}.", samples Rahul and DIWALI20. Submit gave **Needs fixing: "The body cannot start or end with a variable. Add words before and after it."** Nothing went to Meta. The spec's example body ends with `{{2}}.`, which breaks M5's rule, so the 2 November run and this one use "…Use code {{2}} today." After that edit, Submit went to the fake Meta through the worker, the approval webhook came back through the receiver, and the open page changed to **Approved** by itself.

## Steps 1 to 5: the draft and its summary

Push Campaign, new: "Diwali 2026 wave 1", template `diwali_offer_2026`, the file, the opt-in tick.

- "diwali_customers.csv: 1,000 rows." and the first 10 rows, starting with Rahul.
- Number column `Mobile`: **"950 valid, 40 invalid, 10 duplicates."** with a download of those rows and their reasons.
- `{{1}}` from the `Name` column, `{{2}}` fixed text `DIWALI20`. Preview: **"Hi Rahul, flat 20% off till Sunday. Use code DIWALI20 today."**

Summary on the page:

```text
Rows in the file               1,000
Will send                        930
Blocked                           20
  Opted out                       20
Invalid (not charged)             40
  Not a mobile number             25
  Spoiled by Excel (9.19E+11)      4
  Too short                        8
  Wrong country                    3
Duplicates (not charged)          10
Price per message              ₹1.13 (includes 18% GST)
Messages charged                 950
Charge now                 ₹1,073.50      (spec: 950 × ₹0.95 = ₹902.50)
Available in wallet        ₹2,000.00
Available after this         ₹926.50
```

## Steps 6 to 8 and 10: confirm, send, failures, completion

"Confirm and charge ₹1,073.50". The campaign page opened at Sending and moved on its own (at 6 seconds: sent 250, delivered 150, read 100). Within about 30 seconds it showed:

```text
Diwali 2026 wave 1                         COMPLETED
To send 930   Sent 918   Delivered 918   Read 918   Failed 12   Blocked 20
Charged ₹1,073.50   Refunded ₹13.56   Net ₹1,059.94      (spec: ₹902.50, ₹11.40, ₹891.10)
Why messages failed:  Message undeliverable 7   Meta limit, not retried 5
```

The database:

```sql
select name, status, total, blocked, read, failed from campaigns;
select status, meta_error_code, block_reason, count(*) from messages where campaign_id is not null group by 1, 2, 3 order by 1, 2;
```

```text
        name        |  status   | total | blocked | read | failed
--------------------+-----------+-------+---------+------+--------
 Diwali 2026 wave 1 | completed |   950 |      20 |  918 |     12

 status  | meta_error_code | block_reason | count
---------+-----------------+--------------+-------
 blocked |                 | opted_out    |    20
 failed  |          131026 |              |     7
 failed  |          131049 |              |     5
 read    |                 |              |   918
```

Each message is kept under its latest status, so the page's Sent and Delivered of 918 are the 918 that went on to be read.

The ledger: one charge and one refund per failure, in whole paise.

```text
  kind  | amount_paise | balance_after_paise |             note
--------+--------------+---------------------+------------------------------
 topup  |       200000 |              200000 | NEFT UTR 5120
 charge |      -107350 |               92650 | Campaign: Diwali 2026 wave 1
 refund |          113 |               92763 | Failed at Meta
   … 12 refund rows of 113 in all …
 refund |          113 |               94006 | Failed at Meta
```

Sum of rows 94006 = latest balance, ₹940.06 (spec: ₹1,108.90 at ₹0.95 and no GST).

```text
numbers messaged twice:            0
opted-out numbers sent to:         0
messages carrying Rahul and DIWALI20: 1 (Rahul's own)
```

Notifications:

```text
       event        |       email        | channel | status
--------------------+--------------------+---------+--------
 campaign.completed | meera@reaplift.com | email   | sent
 campaign.completed | meera@reaplift.com | panel   | sent
 campaign.completed | ops@northwind.com  | email   | sent
 campaign.completed | ops@northwind.com  | panel   | sent
 campaign.started   | meera@reaplift.com | panel   | sent
 campaign.started   | ops@northwind.com  | panel   | sent
```

## Step 9: a customer replies STOP

An inbound "STOP" from `919800004500` (a number that had read the campaign) to `phone-1`: the webhook answered 200, and

```text
     client     |    number    |   source
----------------+--------------+------------
 Northwind Labs | 919800004500 | stop_reply
```

A second campaign, "Diwali 2026 wave 2", with the same file and mapping, summarised as **will send 929, blocked 21, opted out 21**. No other client has the number.

## What-if: not enough money

Wave 2's summary also showed the spec's what-if, as the wallet now held ₹940.06: "Available after this -₹133.44" and **"Top up needed: ₹133.44 short. See Wallet."**, with "Confirm and charge ₹1,073.50" disabled. Calling the confirm route anyway:

```text
POST /api/clients/NORTHWIND/campaigns/WAVE2/confirm -> 402 {"error":"INSUFFICIENT_BALANCE","message":"Top up needed","shortPaise":13344}
```

Afterwards wave 2 was still `draft` with 0 messages, and the ledger still had 14 rows and ₹940.06.

## Load test

The 7.10 report is in [test-evidence.md](test-evidence.md#710-load-test).

## Not done here

- The real half of the demo: ReapLift's test number, three team phones, and a STOP from a real phone (E1, E2). Meta's own failure titles, which the page shows, are only known against real Meta.
- Real email (E5): every email went through the fake provider.
- The spec's template body ends with `{{2}}.` and fails M5's own rule; the worked example's text should say "…Use code {{2}} today." (for the spec's owner to change).
