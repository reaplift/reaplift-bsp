# M5 test evidence

The commands and output that prove M5's backend. Run on 31 October 2026 as separate real processes (fake Meta, API, worker, receiver, scheduler) over real HTTP and PostgreSQL 16.

**Everything here uses the fake Meta server, and there are no screens yet.** M5 is In progress: all backend tasks are built, and the screens are not started. The hand run below covers 5.1, 5.3 and 5.4; 5.2, media upload and token replacement are proved by the integration tests only. The questions only Meta can settle are in [open-questions.md](../../open-questions.md).

## Set up

Start as in [M4's test evidence](../m4-send-engine/test-evidence.md), using a database called `reaplift_m5`, then also run these:

```bash
pnpm --filter @reaplift/server cli seed-dev
MODE=scheduler pnpm --filter @reaplift/server dev
```

Then, in the terminal you test from:

```bash
B=http://localhost:3000; O='origin: http://localhost:5173'; J='content-type: application/json'
login() { curl -s -i -X POST $B/api/auth/login -H "$O" -H "$J" -d "{\"email\":\"$1\",\"password\":\"reaplift-dev-1\"}" | tr -d '\r' | grep -i '^set-cookie' | sed -E 's/^[^:]+: ([^;]+).*/\1/'; }
RAVI=$(login ravi@reaplift.com); OPS=$(login ops@northwind.com)
C=$(docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift_m5 -Atc "select id from clients where name='Northwind Labs'")
```

## 1. Connect a number (5.1)

```bash
curl -s -X POST $B/api/admin/clients/$C/wa-accounts -H "$O" -H "$J" -H "cookie: $RAVI" \
  -d '{"wabaId":"waba-1","phoneNumberId":"phone-1","token":"good-token"}'
```

| Case | Result |
| --- | --- |
| Client user calls it | 403 |
| Wrong token | 400 `META_REFUSED`: `Meta refused: Invalid OAuth access token (code 190)`; nothing saved |
| Super admin, right token | 201 with the account box, and no token in the response |

## 2. A template's life (5.3, 5.4)

The worked example, through the routes `POST .../templates`, `POST .../templates/:id/submit` and `PUT .../templates/:id`:

| Step | Result |
| --- | --- |
| Submit as UTILITY | 422: `The body contains promotional words ('flat', '% off'). UTILITY templates cannot advertise.` No call to Meta |
| Change to MARKETING, submit | 202, then `PENDING` with `metaTemplateId: tmpl-1` |
| Signed `REJECTED` webhook, `INVALID_FORMAT` | `REJECTED`, with the reason |
| Edit, submit again | 202, then `PENDING`, under the same Meta ID |
| Signed `APPROVED` webhook | `APPROVED` |

```sql
select event, channel, email, status from notifications
where event like 'template.%' or event like 'account.%' order by event, email, channel;
```

14 rows: `account.connected` to Asha's login, Meera and Ravi; `template.rejected` and `template.approved` to the client user and Meera; each on email and panel, all `sent` through the fake email provider. No real email went out.

## 3. Logs hold no secrets

In this run, the API, worker, receiver and scheduler logs had no line containing the Meta token, the app secret or the seeded password, and no error-level line.

## 4. Automated tests

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` | clean |
| `pnpm test` | shared 19, server 57, web 95, all pass |
| `DATABASE_URL=<a separate test database> pnpm test:int` | 8 files, 114 tests when M5 was built, all pass |

`test/template-rules.test.ts` has failing and passing cases for each rule. `test/numbers-templates.int.test.ts` covers the following, on real PostgreSQL and the fake Meta server over HTTP:

- 5.1: the token is encrypted and never returned; bad details save nothing; only a super admin connects; the public development key answers 503.
- 5.3 and 5.4: the worked example; a failing template makes no call to Meta; a webhook and a sync update once; the sync catches a missed change, leaves a draft alone, and copies in templates made at Meta; refused, temporary and account errors; two workers submit once; approved templates cannot be edited; copying; a name Meta has cannot change; clients are kept apart; `listApprovedTemplates`.
- 5.5: Medium to Low pauses; back to Medium does not resume; resume needs a super admin and is audited; a resumed account stays resumed at Low; sending stops while paused.
- 5.6: each event reaches the right people.
- 5.2: a client connects its number, with Meta's calls in order and the right token on each; assigned staff can too; a refused code or registration saves nothing; a sharing failure saves the account paused, resume refuses, and retrying the share activates it; before E7 the account stays paused.
- 5.3.4: a media header fails until a file is uploaded, then the file is stored and the handle saved; a wrong type, empty or oversized file, and another client are refused.
- Replacing a token: only a super admin, only after Meta accepts it, and it does not resume the account.

M1's route-walking test also covers the new routes.

## 5. Not run

- Quality dropping to Low is proved only in the automated tests, not by hand, as the scheduler reads it hourly.
- The demo in the spec needs real Meta (E1 to E3), the screens, and M3's Admin page.
