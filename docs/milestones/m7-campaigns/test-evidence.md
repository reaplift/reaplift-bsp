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
