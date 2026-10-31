# M7 test evidence

Run on 31 October 2026. **Backend only, against the fake Meta server:** the screens are not built, and no message reached a phone, so M7 is not Done.

## Run it

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m7"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m7 pnpm --filter @reaplift/server test:int
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "drop database reaplift_m7 with (force)"
```

`test/numbers.test.ts` checks 30 raw numbers against the cleaning rules. `test/campaigns.int.test.ts` runs through the HTTP routes on real PostgreSQL:

| Task | Proved |
| --- | --- |
| 7.1 | Rows saved as read; blank rows counted; opt-in required and recorded; Excel with text and number cells, merged headers and formulas; corrupt, empty, over-long and oversized files refused; a path in a file name dropped; another client's list is 404 |
| 7.2 | Counts match a hand count; invalid rows download with reasons; a downloaded cell cannot run as a formula |
| 7.3 | Unapproved templates refused; other clients' IDs are 404; a draft can be partly mapped |
| 7.4, 7.5 | The worked example's summary; parts add up to the total; a short balance writes nothing; confirming twice at once charges once; an opt-out after the summary is caught; a paused number, unapproved template and suspended client are refused; charging switches followed |
| 7.6, 7.7 | Totals equal a count of rows; a failure refunds once however often Meta repeats it; the nightly money check is clean, and catches a planted difference |
| 7.6a | A send with no answer is held; its webhook shows Meta took it, so it is sent exactly once; with no webhook it retries when the hold ends; an error answer is not held; a webhook after the retry changes nothing |
| 7.8 | STOP blocks for this client only; repeat STOP saves one row; only the exact word counts |
| 7.9 | Each event fires once |

## 7.10 Load test

This ran before the limit per campaign became 20,000 rows, so it tested ten times the current limit.

`test/support/load-test.ts`, with 1% of sends failing:

```bash
cd apps/server
DATABASE_URL=<a throwaway database> node --max-old-space-size=4096 --import tsx test/support/load-test.ts 200000 1000
```

| Step, 200,000 rows | Result |
| --- | --- |
| Clean numbers | 2.1 s |
| Summary | 0.1 s (target 30 s) |
| Confirm, in one transaction | 2.6 s |
| Send everything at a setting of 1,000 per second | 219.6 s; busiest second exactly 1,000 |
| Sends to Meta | 200,000, and no number sent to twice |
| Messages | 198,000 sent, 2,000 failed; campaign totals match |
| Money | One charge of ₹190,000.00; 2,000 refunds totalling ₹1,900.00; nightly check clean |
| Process memory | 658 MB at the end, which includes the fake server's record of every request |

Separately, a 3.6 MB Excel file of 200,000 rows was read in 1.3 s, with the process at about 1.2 GB, including building the file in the same process. That read holds the whole file in memory, so a 50 MB file needs a server with room for it. This first took over 9 minutes, because of a bug in our reader, now fixed.

Limits: everything ran on one machine against a fake server that answers at once, so this measures our code and database, not Meta. Delivery webhooks were not part of this run. The 200,000-row upload's own time scrolled out of the output and was not recorded; the same step for 20,000 rows took 0.1 s.

## End to end at campaign size, as real processes

Run on 31 October 2026: API, worker, receiver, scheduler and fake Meta as separate processes on one laptop, with signed webhooks over real HTTP (sent, delivered, read for each accepted message) and 1% of sends failing. Each campaign went through the real upload, cleaning, summary and confirm routes.

| | 20,000 at 50 a second | 20,000 at 200 a second, first run | 20,000 at 200 a second, after the fix |
| --- | --- | --- | --- |
| All sent to Meta | 438 s (estimate was 400 s) | 115 s | 109 s |
| Campaign finished, all webhooks handled | 443 s | 393 s | 109 s |
| Most webhooks waiting at once | 149 | 42,100 | 489 |
| Messages read, failed | 19,800, 200 | 19,800, 200 | 19,800, 200 |
| Double sends, webhook errors | 0, 0 | 0, 0 | 0, 0 |

- Money: each campaign charged ₹3,000 and refunded ₹30 for 200 failures; the nightly check was clean. The per-number report of 20,000 rows downloaded in 0.17 s as CSV and 0.25 s as Excel.
- Serving stayed quick under load: health check about 1 to 5 ms, dashboard about 2 to 9 ms. Worker, receiver and API each stayed under about 300 MB.
- Database after 40,000 messages and 118,800 webhooks: 122 MB, of which raw webhooks 59 MB and messages 27 MB.
- Two things this found, both fixed: webhook handling topped out near what one number produces at 50 a second, so it now runs four processors side by side; and sending reached about 91% of its setting, so the estimate allows for that.

Limits: one number only, on one laptop, against a fake server that answers at once. Several clients at once, and the fix at the 50-a-second rate, were not run.
