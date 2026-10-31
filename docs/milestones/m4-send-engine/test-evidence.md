# M4 test evidence

Every command and query needed to prove the send engine works, with the output from a real run. Run on 30 October 2026, as separate real processes (fake Meta, API, worker, receiver) over real HTTP and PostgreSQL 16.

**Everything here uses the fake Meta server: no message reached a phone.** The real-phone demo needs E1 and E2 and has not been run, so M4 is not Done. See section 8.

## Set up

This uses its own database, `reaplift_m4`, so your dev data is untouched. Stop `pnpm dev` first, because the API below uses port 3000.

Run this once, from the repo root:

```bash
pnpm db:up
docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "create database reaplift_m4"
```

Paste this block into **each of the five terminals** below:

```bash
export DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_m4
export META_API_BASE_URL=http://127.0.0.1:4010
export META_APP_SECRET=local-test-secret
export META_VERIFY_TOKEN=local-verify-token
export APP_ENCRYPTION_KEY=abcdefghijklmnopqrstuvwxyz123456
export LOG_LEVEL=info
sql() { docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift_m4 -c "$1"; }
```

These values are for this local test only. Then start each part:

| Terminal | Command                                         | What it does                                                               |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| 1        | `pnpm --filter @reaplift/server migrate`        | Creates the tables, then this terminal is free to run the fake             |
| 1        | `pnpm --filter @reaplift/server fake-meta`      | Stands in for Meta, and posts signed webhooks after accepting each message |
| 2        | `MODE=api pnpm --filter @reaplift/server dev`   | Receives the webhooks                                                      |
| 3        | `MODE=worker pnpm --filter @reaplift/server dev` | Sends queued messages                                                      |
| 4        | `MODE=receiver pnpm --filter @reaplift/server dev` | Turns stored webhooks into statuses                                        |
| 5        | The commands below                              |                                                                            |

## 1. Connect an account (4.1, 4.6)

The token is prompted for and not echoed, so it is not in shell history. The fake accepts `good-token`.

```bash
pnpm --filter @reaplift/server cli seed-account --waba-id waba-1 --phone-number-id phone-1
```

A wrong token saves nothing:

```
Error: Meta refused: Invalid OAuth access token (code 190)
```

The right one:

```
Connected account fa46d8cf-...; copied 1 templates.
```

With the real Meta address and no `APP_ENCRYPTION_KEY`, the command refuses to store a token under the public development key:

```
Error: set APP_ENCRYPTION_KEY in .env first (32 characters, from `openssl rand -base64 24`)
```

```sql
select phone_number_id, display_phone, status,
  left(encode(access_token_enc, 'escape'), 12) || '...' as token_stored,
  encode(access_token_enc, 'escape') like '%good-token%' as contains_token
from wa_accounts;
```

```
 phone_number_id | display_phone | status |  token_stored   | contains_token
-----------------+---------------+--------+-----------------+----------------
 phone-1         | 919800000000  | active | 361a53e12f39... | f
```

```sql
select name, language, category, status, variable_count from templates;
```

```
    name     | language | category |  status  | variable_count
-------------+----------+----------+----------+----------------
 hello_world | en_US    | UTILITY  | APPROVED |              0
```

## 2. Send one message through every status (4.3, 4.4, 4.5, 4.7)

```bash
pnpm --filter @reaplift/server cli send-test --to 919812345678 --template hello_world --lang en_US
# queued message 1
```

Wait about 5 seconds, then:

```bash
pnpm --filter @reaplift/server cli show-message 1
```

```
{
  id: 1,
  status: 'read',
  to_number: '919812345678',
  attempts: 1,
  meta_message_id: 'wamid.fake-mvvwgt5t-1',
  queued_at: 2026-10-31T04:27:27.335Z,
  sent_at: 2026-10-31T04:27:27.660Z,
  delivered_at: 2026-10-31T04:27:29.000Z,
  read_at: 2026-10-31T04:27:30.000Z,
  failed_at: null,
  failure_reason: null,
  meta_error_code: null,
  pricing_category: 'utility',
  billable: true
}
┌─────────┬─────────────┬──────────────────────────┐
│ (index) │ status      │ meta_timestamp           │
├─────────┼─────────────┼──────────────────────────┤
│ 0       │ 'sent'      │ 2026-10-31T04:27:28.000Z │
│ 1       │ 'delivered' │ 2026-10-31T04:27:29.000Z │
│ 2       │ 'read'      │ 2026-10-31T04:27:30.000Z │
└─────────┴─────────────┴──────────────────────────┘
```

```sql
select status, meta_timestamp, meta_event_id from message_status_events order by meta_event_id;
select id, processed_at is not null as processed, process_error from meta_events order by id;
```

Three status rows, one for each of events 1, 2 and 3, with all three events `processed = t` and no `process_error`.

## 3. Webhook security and replay (4.4, 4.5)

```bash
HOOK=http://localhost:3000/webhooks/meta
curl -s "$HOOK?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=local-verify-token"    # abc
curl -s -o /dev/null -w '%{http_code}\n' "$HOOK?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=wrong"    # 403

BODY=$(docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift_m4 -Atc "select body::text from meta_events where id = 2")
SIG=sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$META_APP_SECRET" | sed 's/^.* //')
curl -s -o /dev/null -w 'signed: %{http_code}\n' -X POST $HOOK -H 'content-type: application/json' -H "x-hub-signature-256: $SIG" -d "$BODY"
curl -s -o /dev/null -w 'tampered: %{http_code}\n' -X POST $HOOK -H 'content-type: application/json' -H "x-hub-signature-256: $SIG" -d "$BODY "
curl -s -o /dev/null -w 'unsigned: %{http_code}\n' -X POST $HOOK -H 'content-type: application/json' -d "$BODY"
```

```
signed: 200
tampered: 401
unsigned: 401
```

The signed replay stored one more event, and `show-message 1` did not change:

```sql
select count(*) as events, count(*) filter (where processed_at is null) as unprocessed from meta_events;
select count(*) as status_rows from message_status_events;
```

```
 events | unprocessed
--------+-------------
      4 |           0

 status_rows
-------------
           3
```

## 4. A permanent error fails at once

Stop the fake with Ctrl+C and restart it in terminal 1 with `FAKE_META_FAIL_CODE=131026 pnpm --filter @reaplift/server fake-meta`, then:

```bash
pnpm --filter @reaplift/server cli send-test --to 915812345678 --template hello_world --lang en_US
```

```sql
select id, status, attempts, meta_error_code, failure_reason from messages where id = 2;
```

```
 id | status | attempts | meta_error_code | failure_reason
----+--------+----------+-----------------+----------------
  2 | failed |        1 |          131026 | error 131026
```

## 5. An account error pauses the account, and the message waits

Restart the fake with `FAKE_META_FAIL_CODE=190`, then send to `919812345678` the same way.

```sql
select status, paused_reason from wa_accounts;
select id, status, attempts, meta_error_code from messages where id = 3;
```

```
 status | paused_reason
--------+---------------
 paused | token invalid

 id | status | attempts | meta_error_code
----+--------+----------+-----------------
  3 | queued |        0 |             190
```

Worker log:

```
{"level":50,"accountId":"fa46d8cf-...","reason":"token invalid","code":190,"msg":"WhatsApp account paused"}
```

Restart the fake with no failure code. The message stays `queued` while the account is paused. Resume the account, and within seconds the message reaches `read`:

```sql
update wa_accounts set status = 'active', paused_reason = null;
```

No screen or command resumes an account or replaces a token yet. That is M5.

## 6. Logs hold no secrets

In this run, the API, worker and receiver logs had no line containing the token, the app secret or the verify token. Request logs drop the query string, because Meta's webhook check carries the verify token there. Message logs carry the message ID, never the phone number.

## 6a. Measure double sends

Meta accepts the first send but answers after the worker's 30 second timeout, so the retry sends the message again. Run on 31 October 2026. Restart the fake with `FAKE_META_LATE_FIRST_MS=31000`, send one message, and wait about 80 seconds:

```bash
pnpm --filter @reaplift/server cli send-stats --days 30
```

```
│ client                   │ messages │ accepted │ retried │ duplicated │ extra_sends │ failed_but_sent │ duplicate_percent │
│ 'ReapLift Internal Test' │ 1        │ 1        │ 1       │ 1          │ 1           │ 0               │ 100               │
```

The fake's log shows both sends, `wamid.fake-mvwmtck8-1` and `-2`. The output above is from a fresh database with only this message, so your numbers include your earlier sends.

- `duplicated`: messages Meta reported under two or more `wamid`s, as a share of `accepted` in `duplicate_percent`.
- `extra_sends`: the sends beyond the first.
- `failed_but_sent`: messages we marked failed that Meta reports as sent.

A `wamid` Meta reports as failed is not counted. The webhooks of the lost `wamid` also end with `process_error = 'message not found'` after 10 minutes, which is expected until M7 task 7.6a.

## 7. Automated tests

| Command                                                 | Result                                                 |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`             | clean                                                  |
| `pnpm test`                                             | shared 19, server 45, web 95, all pass                 |
| `DATABASE_URL=<a separate test database> pnpm test:int` | 7 files, 82 tests, all pass                            |

`pnpm test:int` drops the schema of the database it runs on; see [M0's test evidence](../m0-foundation/test-evidence.md) for the safe command.

`test/messaging.int.test.ts` (29 tests) covers, against real PostgreSQL and the fake Meta server over HTTP:

- 4.1: token encrypted and decrypts back; bad token, wrong phone number and repeat connection are refused and save nothing.
- 4.2 and 4.3: send with the account's own token; empty queue does nothing; 429 waits 30 seconds then succeeds; a timeout retries; gives up after 5 attempts; codes 131026, 131049, 131050 and 132001 fail at once and never retry; 190 pauses the account and the message keeps its attempt and sends after resume; an undecryptable token pauses without calling Meta; two workers never send the same row (40 rows); the rate stays within the setting; a row stuck in `sending` is reported and never resent.
- 4.4: a valid POST stores exactly one row, checked against the exact bytes; altered, wrongly signed and unsigned POSTs store nothing.
- 4.5: the same webhook three times changes the row once; read never goes back to delivered; a `failed` webhook records its code, and 131049 is final; failed after delivered is ignored; a status that beats the worker's save waits, works once known, and errors after 10 minutes; replies and other events are stored with no action; a malformed event does not stop the next one; two processors apply each event once.
- 4.6: templates copied across pages; running twice leaves the same rows.
- 4.7: `send-test` refuses a number with a plus, an unknown or unapproved template, and the wrong variable count.
- A dropped database connection does not crash the process.

`meta-client.test.ts` checks the error classes against the codes on Meta's page, and `crypto.test.ts` checks that a changed stored token fails to decrypt.

## 8. Not run: the real-phone demo

This needs E1 (ReapLift's Meta app, test number and system user token) and E2 (Live mode, and a public webhook address). Nothing here has talked to the real Meta API, so the request shapes are checked only against Meta's documentation. When they are ready:

1. Set real values in `.env`: `APP_ENCRYPTION_KEY`, `META_APP_SECRET` and `META_VERIFY_TOKEN`. Leave `META_API_BASE_URL` blank.
2. Run `seed-account` with the real IDs, and enter the token at the prompt.
3. Run `send-test` to the team member's phone, then open the chat.
4. Check `show-message`, re-post one stored webhook, and record the commands, output and a phone screenshot in `e2e.md`.
