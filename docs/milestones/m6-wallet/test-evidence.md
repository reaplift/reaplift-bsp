# M6 test evidence

Run on 31 October 2026. **Backend only:** this proves the routes against real PostgreSQL with the fake email provider. The panel's screens are not connected, so M6 is not Done.

## Run it

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m6"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m6 pnpm --filter @reaplift/server test:int
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "drop database reaplift_m6 with (force)"
```

## What `test/wallet.int.test.ts` proves

| Area | Proved |
| --- | --- |
| Prices | 86.31 paise at 20% becomes 104 paise; a client markup beats the default; different markups per message type; a fixed price beats a markup; a future Meta rate applies only from its start date, and old prices stay in history; clients see prices but no rate or markup |
| Switches | Defaults follow HLD section 5 and D6; a client switch beats the global one |
| Ledger | The worked example's top-ups and correction; the database refuses update and delete; two charges with money for one: exactly one succeeds; 20 changes at once keep the balance equal to the sum of the rows; a refund for one message happens once |
| Alert | Crossing the level notifies Asha, Meera and Ravi once; a further drop does not; going back above re-arms it |
| Access | Client and staff get 403 on money and rate routes; another client's wallet is 404; bad amounts are 400; each change writes one audit row |
| Nightly check | A planted mismatch alerts super admins once a day |

Not run: the panel steps of the demo, which need the screens.
