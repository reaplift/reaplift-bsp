# M9 test evidence

Run on 31 October 2026. **Backend only, against the fake Meta server:** the dashboard and report screens are not built, and no real Meta invoice exists until E7, so M9 is not Done.

## Run it

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m9"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m9 pnpm --filter @reaplift/server test:int
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "drop database reaplift_m9 with (force)"
```

`test/reports.int.test.ts` proves, through the HTTP routes on real PostgreSQL:

| Task | Proved |
| --- | --- |
| 9.1 | A rebuild equals a count of rows, and repeats give the same figures; 23:59 and 00:01 India time land on the right days |
| 9.2 | The four tiles and 15-day chart match a hand count; the account box shows; clients and staff get no cost, margin or rate in any response |
| 9.3 | Dovesoft's columns in order; each row adds up to the campaign's messages; CSV, and an Excel file read back with the same headings |
| 9.4 | Dovesoft's columns; India-time `dd/mm/yyyy hh:mm:ss`; every number once; a 5,100-row report spanning batches, in CSV and Excel |
| 9.5 | Meta's own category and the rate valid at delivery; recorded once; free messages cost nothing; failed messages have no cost |
| 9.6 | Billed, cost and margin per client match a hand sum; errors by code; client and staff get 403 |
| 9.7 | Within 0.5% is clean; beyond it alerts and lists the largest differences; a planted wrong rate is caught |
| 9.8 | 80% and 95% each alert once a month; no alert without a limit |

Not run: a 20,000-row export's memory use, the one-second dashboard target on 6 months of data, and the demo's panel steps.

## The whole backend, as real processes

Run on 31 October 2026: the API, worker, receiver, scheduler and fake Meta server as separate processes, over real HTTP, on a fresh database. One journey through the routes:

1. Create a client and its login; the login must change its first password.
2. Enter a Meta rate, set the client's markup (86.31 paise at 20% gave 104 paise), and top up ₹2,000.
3. Connect a number; submit a template; a signed webhook approves it.
4. Upload a 6-row CSV: 4 valid, 1 invalid, 1 duplicate. One number was opted out.
5. Summary: 3 to send, 1 blocked, ₹4.16. Confirm charged ₹4.16; a second confirm answered `ALREADY_CONFIRMED`.
6. The worker sent 3 messages. Signed webhooks took each to read. The campaign completed; the balance was ₹1,995.84.
7. A rule against repeats blocked those 3 numbers in the next campaign's summary.
8. The month-wise and per-number reports matched the rows; a client got 403 on the Meta view.

Every email went through the fake provider as `sent`. No log held the Meta token, the app secret or a password; no process logged an error, and all four were still running at the end.

This run showed that a delivered message with no Meta rate left its cost blank without saying so. It now logs a warning, and has a test.
