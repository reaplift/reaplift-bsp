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

## The screens, in a real browser

Run on 2 November 2026: Google Chrome driven by Playwright through the panel, against the real API, worker, receiver and scheduler on real PostgreSQL, and the fake Meta server. A campaign was made through the routes, as its screens are M7. Output of the run:

```
ok   new client opens onto Money and Prices, with no price before Meta rates exist
ok   GST defaults to 18%
ok   step 1: Meta rates entered
ok   step 1: 86.31 paise at 20% is ₹1.04, and ₹1.23 with GST
ok   a fixed price below Meta's rate warns
ok   step 2: top-up of ₹10,000
ok   step 3: duplicate corrected; balance ₹11,000
ok   a correction past the balance is refused, in words
ok   step 5: client sees balance, prices with GST and ledger; no Meta rate or markup
ok   client refused the money routes and sent away from Settings
ok   a scheduled campaign shows on hold, and a started one shows its charge with GST
ok   the month's statement splits ₹17.00 into ₹14.41 and ₹2.59 GST
ok   a new GST rate reaches the client's prices: ₹1.04 at 28% is ₹1.34
ok   the accountant's report shows the GST
ok   charging switches save; the one that cannot work is locked
ok   every money change is in the audit log
browser errors: none
server errors: 0
```

`apps/web/test/m6-screens.test.tsx` holds the component tests, and `packages/shared/test/money.test.ts` the typed-amount rules. Steps 4 and 6 of the worked example (the low-balance email, and the nightly check's alert) are proved by `test/wallet.int.test.ts`, not seen in this browser run.
