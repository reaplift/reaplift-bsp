# M2 end-to-end run

29 October 2026, local PostgreSQL after `pnpm migrate` (0001 to 0005 applied) and `cli seed-dev`. The worker ran as `MODE=worker` with `EMAIL_PROVIDER=fake`.

## Demo step 1: a test email is sent

```
$ pnpm --filter @reaplift/server cli notify-test --email test@example.com
Queued test email to test@example.com (entity c63c9b47-…); the worker sends it within seconds.

worker log: "fake email provider: email \"sent\"" with subject "ReapLift test notification"

$ pnpm --filter @reaplift/server cli show-notifications
created 05:33:58.444  system.test  email  test@example.com  sent  attempts 1  sent_at 05:33:59.597  last_error null
```

## Demo step 2: a failing provider retries, then gives up

Worker started with `EMAIL_FAKE_FAIL="fake provider told to fail"`; `cli notify-test --email retry@example.com` at 05:34:16.

| Time (UTC) | Worker log                   | Attempts | Gap since previous |
| ---------- | ---------------------------- | -------- | ------------------ |
| 05:34:17   | notification will be retried | 1        | first try          |
| 05:34:47   | notification will be retried | 2        | 30 s               |
| 05:35:47   | notification will be retried | 3        | 1 min              |
| 05:37:47   | notification will be retried | 4        | 2 min              |
| 05:41:48   | notification failed for good | 5        | 4 min              |

```
$ pnpm --filter @reaplift/server cli show-notifications --status failed
system.test  email  retry@example.com  failed  attempts 5  next_attempt_at null  sent_at null  last_error 'fake provider told to fail'
```

## Demo step 3: a rolled-back change notifies nobody

Covered by the integration test "writes nothing when the transaction rolls back" (`test/notifications.int.test.ts`); see `test-evidence.md`.

## Demo step 4: a real email from info@reaplift.com

Not run yet: needs E5 (`info@reaplift.com` approved as a sender in OCI Email Delivery, and SMTP credentials). Then: set `EMAIL_PROVIDER=smtp` and the `SMTP_` settings in `.env`, start the worker, run `cli notify-test --email <a real inbox>`, and record the received email here.
