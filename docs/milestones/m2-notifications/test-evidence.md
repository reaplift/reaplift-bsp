# M2 test evidence

Every command and query needed to prove M2 works, with the output from a real run. Run on 30 October 2026 at commit `1bd372d`, with the fake email provider. The full retry timing is in [e2e.md](e2e.md).

**A row marked `sent` under the fake provider means no real email left the machine.** A real email is demo step 4, which needs E5 and has not been run.

## Set up

Run from the repo root. M2 has no screen yet, and `pnpm dev` does not start the worker.

```bash
pnpm db:up
pnpm migrate
```

In the terminal you will query from, paste:

```bash
sql() { docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "$1"; }
```

## 1. A test email is sent

Terminal 1:

```bash
MODE=worker EMAIL_PROVIDER=fake pnpm --filter @reaplift/server dev
```

The worker's first log line must name the provider:

```
{"level":30,"loops":["notifications"],"emailProvider":"fake","msg":"worker started"}
```

Terminal 2:

```bash
pnpm --filter @reaplift/server cli notify-test --email test@example.com
pnpm --filter @reaplift/server cli show-notifications
```

Worker log:

```
{"level":30,"email":{"to":"test@example.com","subject":"ReapLift test notification","text":"This is a test email from ReapLift, ..."},"msg":"fake email provider: email \"sent\""}
```

```sql
select event, channel, email, status, attempts, sent_at is not null as has_sent_at, last_error
from notifications where email = 'test@example.com';
```

```
    event    | channel |      email       | status | attempts | has_sent_at | last_error
-------------+---------+------------------+--------+----------+-------------+------------
 system.test | email   | test@example.com | sent   |        1 | t           |
```

## 2. A failing provider retries, then gives up

Stop the worker with Ctrl+C. Terminal 1:

```bash
MODE=worker EMAIL_PROVIDER=fake EMAIL_FAKE_FAIL="fake provider told to fail" pnpm --filter @reaplift/server dev
```

Terminal 2:

```bash
pnpm --filter @reaplift/server cli notify-test --email retry@example.com
```

Worker log, seconds later:

```
{"level":40,"event":"system.test","attempts":1,"error":"fake provider told to fail","msg":"notification will be retried"}
```

```sql
select email, status, attempts, next_attempt_at is not null as will_retry, last_error
from notifications where email = 'retry@example.com';
```

```
       email       | status  | attempts | will_retry |         last_error
-------------------+---------+----------+------------+----------------------------
 retry@example.com | pending |        1 | t          | fake provider told to fail
```

Today's run stopped here. Leave the worker running for about 7.5 minutes to see attempts at 30 seconds, then 1, 2 and 4 minutes, ending in `failed` with `attempts = 5`. That full run was recorded on 29 October 2026 in [e2e.md](e2e.md).

Stop this worker when you finish, or new notifications will keep failing.

## 3. A rolled-back change notifies nobody

No feature calls `notify()` yet, so this has no manual steps. The integration test "writes nothing when the transaction rolls back" in `notifications.int.test.ts` proves it.

## 4. A real email: not run

This needs E5 or another SMTP account. Set `EMAIL_PROVIDER=smtp` and the `SMTP_` settings, start the worker, and run `notify-test` with a real address. The worker's first log line must say `"emailProvider":"smtp"`.

## 5. Automated tests

| Command                                                 | Result                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`                           | clean; typecheck includes the "notify() needs a transaction" check               |
| `pnpm test`                                             | shared 19, server 41, web 95, all pass                                           |
| `DATABASE_URL=<a separate test database> pnpm test:int` | 6 files, 46 tests, all pass, including `notifications.int.test.ts` (12)          |

`pnpm test:int` drops the schema of the database it runs on; see [M0's test evidence](../m0-foundation/test-evidence.md) for the safe command.

What the tests cover, by task:

- 2.1 (`notifications.test.ts`, `notifications.int.test.ts`): calling `notify()` with a plain Kysely instance instead of a transaction does not compile (`@ts-expect-error`, checked by `pnpm typecheck`); an unknown event is refused; a rolled-back transaction leaves no row (demo step 3); the same event twice writes one row, the replay writes none.
- 2.2 (`notifications.int.test.ts`): a pending email is sent once by the fake provider and marked `sent`; a later run sends nothing more; two delivery runs at the same time over 40 rows send each row exactly once; a failing provider is retried after exactly 30 s, 1, 2 and 4 minutes, a row is not claimed a second before it is due, and after 5 attempts the row is `failed` with the error and is never tried again.
- 2.3 (`notifications.int.test.ts`): `client_users` and `assigned_staff` return only that client's people; an event for Greenleaf never reaches Northwind's users or staff; `super_admins`, `actor` and `user`; an address found by two rules appears once; a disabled user gets nothing; a rule missing the scope it needs is an error.
- 2.4: run by hand, sections 1 and 2 above.
