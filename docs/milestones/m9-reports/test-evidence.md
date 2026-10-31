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

Not run: a 200,000-row export's memory use, the one-second dashboard target on 6 months of data, and the demo's panel steps.
