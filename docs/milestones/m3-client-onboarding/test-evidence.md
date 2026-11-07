# M3 test evidence

Run on 31 October 2026. **Backend only, as it was then:** this proves the routes against real PostgreSQL with the fake email provider. The screens and the full demo came later; see [frontend.md](frontend.md) and [e2e.md](e2e.md).

## Run it

```bash
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m3"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m3 pnpm --filter @reaplift/server test:int
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "drop database reaplift_m3 with (force)"
```

## What `test/client-onboarding.int.test.ts` proves

Each worked-example step, through the HTTP routes:

| Step | Proved |
| --- | --- |
| 1 Create a client | One audit row; note to the contact email; repeat name in any case is 409; missing country or email is 400 |
| 2 Create a login | `created_by` comes from the session; a taken email is 409; the first password is in no response, email, notification or audit row |
| 3 First login | Every route but the password change and logout answers 403 `PASSWORD_CHANGE_REQUIRED`; the old password then stops working |
| 4 Staff | Workspaces are exactly the assigned clients; the bell shows the assignment; replacing the list takes effect at once and records before and after |
| 5 Suspend | A note is required; client routes answer 403 `CLIENT_SUSPENDED`; other clients stay open; a second suspension notifies again |
| 6 Reset | Sessions are revoked and a change is forced; the email holds no password |
| 7 Audit | Filters by client, user, action and date, and pages correctly; a change that fails writes no row |

Also: disabling revokes sessions at once; a user sees and marks only their own notifications; client and staff get 403 on the delivery log; a login locked by wrong passwords tells its owner.

Not run here: the restart step of the demo and the panel steps. Both were run on 6 November 2026 ([e2e.md](e2e.md)).

## The screens, in a real browser

Run on 2 November 2026: Google Chrome driven by Playwright through the panel at `http://localhost:5173`, against the real API, worker, receiver and scheduler on real PostgreSQL, with the fake email provider. Output of the run:

```
ok   super admin reaches Clients
ok   step 1: client created, opens its page
ok   duplicate name refused in words
ok   step 2: login created
ok   step 3: first password forces a change, even after reload
ok   step 3: password changed, her own workspace opens
ok   client user sent away from Admin
ok   step 4: staff picker shows exactly the two clients
ok   step 4: bell showed "Notifications1", clicking marks it read
ok   step 5: suspended client closed to staff; the other still opens
ok   step 5: super admin can still open it
ok   step 6: reset logs Asha out
ok   step 6: she must choose a new one
ok   she can log out from there
ok   disabled login is refused
ok   step 7: audit filtered to Northwind
ok   delivery log shows the emails
ok   My account: wrong current password refused
browser errors: none
server errors: 0
```

`apps/web/test/m3-screens.test.tsx` holds the component tests. The demo's server restart after step 4, and the emails read from the fake provider's log, are in [e2e.md](e2e.md) (6 November 2026).
