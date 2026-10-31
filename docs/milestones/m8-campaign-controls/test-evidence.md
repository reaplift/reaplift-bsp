# M8 test evidence

Run on 31 October 2026. **Backend only, against the fake Meta server:** the Rules screen and campaign controls are not built, so M8 is not Done. D5 (the cancel money flow) is built as written and is still for the owner to approve.

## Run it

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m8"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m8 pnpm --filter @reaplift/server test:int
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "drop database reaplift_m8 with (force)"
```

`test/campaign-controls.int.test.ts` proves, through the HTTP routes on real PostgreSQL:

| Task | Proved |
| --- | --- |
| 8.1 | A paused campaign sends nothing and moves no money; it carries on when resumed; each change is audited |
| 8.2 | Exact refund in one row; a message already `sending` finishes normally and its failure refunds separately, so net charge equals sent × price; a second cancel, and two at once, refund once; **with the worker sending during the cancel, all 300 messages are accounted for and the nightly check is clean** |
| 8.3 | Scheduling holds the charge, and a second campaign is refused when that leaves too little; two scheduled at once with money for one: exactly one holds it; a due campaign starts, and the hold becomes the charge; a correction cannot take held money; unscheduling and cancelling give it back; a price rise or a paused number at start returns it to draft with the hold released and no ledger row; the nightly check catches a stray hold |
| 8.4 | Each rule on and off, for all clients and one client; a client rule overrides the global one, even when off; a cancelled send is not a repeat; a blocked number is charged and not sent; changes are audited |
| 8.5 | Pause and resume say who did it; cancel gives the refund |

The 10,000-message demo in the spec was not run by hand.
