# M3 test evidence

Run on 31 October 2026. **Backend only:** this proves the routes against real PostgreSQL with the fake email provider. The panel's screens are not connected, so M3 is not Done.

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

Not run: the restart step of the demo and the panel steps, which need the screens.
