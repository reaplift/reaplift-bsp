# M5 test evidence

The commands and output that prove M5's backend. Run on 31 October 2026 as separate real processes (fake Meta, API, worker, receiver, scheduler) over real HTTP and PostgreSQL 16.

**Everything here uses the fake Meta server. The screens were added on 2 November 2026; see the last section.** M5 is In progress: all backend tasks are built, and the screens are not started. The hand run below covers 5.1, 5.3 and 5.4; 5.2, media upload and token replacement are proved by the integration tests only. The questions only Meta can settle are in [open-questions.md](../../open-questions.md).

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

## Screens in a real browser (2 November 2026)

Real API, worker, receiver and scheduler, the fake Meta server and the Vite panel on a throwaway database, driven by Chrome through Playwright. Template answers from Meta are signed webhooks sent to the real receiver. Real Meta was not called.

```text
ok   Generate password fills a 14-character password and shows it
ok   a token Meta refuses shows: Meta refused these details. Check the IDs and token, then try again.
ok   number connected on the real server; token not on the page
ok   speed 20 and daily 500 survive a reload
ok   token replaced
ok   Numbers and limits lists the number
ok   promo words saved
ok   client Settings shows the number with no limit controls
ok   promo word in Utility stopped: The body contains promotional words ('flat 20% off'). UTILITY templates cannot advertise. Change the category to MARKETING...
ok   fixed and submitted; the worker sent it and the page moved to Pending by itself
ok   rejection webhook reaches the open page, with an explanation
ok   rejected template edited and resubmitted
ok   approved: no Edit button
ok   copied into a new draft
ok   picture uploaded through Meta
ok   the client sees why it is suspended
ok   Disable asks first: Disable Asha? They are logged out at once and cannot log in.
ok   Reset password asks first: Reset the password for Asha? They are logged out at once and must choose a new one.
browser errors: 0 []
server errors: 0
```

Automated tests after these screens: integration 271, shared 33, server unit 88, web 144, all passing.

Not proved here: Embedded Signup's button (needs a real Meta app), Resume and Share credit line in the browser (covered by web tests with a stubbed server and by the backend's integration tests), and anything against real Meta.

## Connect WhatsApp in a real browser (5 November 2026)

Task 5.2.1. Real API and Vite panel against the fake Meta server (`pnpm --filter @reaplift/server fake-meta`) on the local `reaplift` database, as `ops@northwind.com` (client), in Chrome. Meta's pop-up cannot open on `http://localhost`, so a stand-in for Meta's SDK was placed in the tab: it sends the `WA_EMBEDDED_SIGNUP` `FINISH` message from `https://www.facebook.com` with `waba_id: waba-northwind`, `phone_number_id: phone-1`, then answers FB.login with the code `good-code`. Everything after that is the real panel, server and database.

Started with:

```bash
META_API_BASE_URL=http://localhost:4010 META_APP_ID=fake-app META_APP_SECRET=fake-app-secret \
META_SYSTEM_TOKEN=system-token META_CREDIT_LINE_ID=credit-line-1 \
VITE_META_APP_ID=fake-app VITE_META_CONFIG_ID=fake-config pnpm dev
```

What the panel passed to Meta's SDK:

```json
[{"init":{"appId":"fake-app","autoLogAppEvents":true,"xfbml":true,"version":"v26.0"}},
 {"login":{"config_id":"fake-config","response_type":"code","override_default_response_type":true,"extras":{"setup":{}}}}]
```

Server log: `POST /api/clients/863644dc-…/wa-accounts/embedded-signup` → `201` in 101 ms, then `GET …/wa-accounts`. The page showed "919800000000 is connected." and the account box: Active, quality GREEN, daily limit 2K, Meta is paid by ReapLift credit line.

```sql
select c.name as client, w.waba_id, w.phone_number_id, w.display_phone, w.status, w.meta_payer, w.onboarded_via,
  w.credit_share_ref, u.email as connected_by,
  w.access_token_enc::text not like '%business-token%' as token_not_plain_text, w.two_step_pin_enc is not null as pin_saved
from wa_accounts w join clients c on c.id = w.client_id left join users u on u.id = w.connected_by;
```

```text
client               | Northwind Labs
waba_id              | waba-northwind
phone_number_id      | phone-1
display_phone        | 919800000000
status               | active
meta_payer           | reaplift_credit_line
onboarded_via        | embedded_signup
credit_share_ref     | alloc-1
connected_by         | ops@northwind.com
token_not_plain_text | t
pin_saved            | t
```

Audit: one `wa_account.connected` row by `ops@northwind.com`. Notifications for `account.connected`: one `email` (pending: no worker running, and E5) and one `panel` (sent) each for `meera@reaplift.com`, `ops@northwind.com` and `ravi@reaplift.com`. Templates copied from Meta: `hello_world`, APPROVED.

Automated tests: web 174 passing (11 new in `embedded-signup.test.ts`: both arrival orders, messages not from `https://*.facebook.com` ignored, CANCEL, ERROR, FINISH_ONLY_WABA, pop-up closed, 10-second wait for the IDs; 5 new in `m5-screens.test.tsx`: off without a Meta app, code and IDs sent and the number shown, cancel sends nothing, META_REFUSED in the client's words, who pays Meta). The 5.2 integration tests and `scope.int.test.ts` pass on a separate database. `numbers-templates.int.test.ts` has one failure, "an account paused by a send error tells everyone once" (expected 3 emails, got 0); it fails the same with these changes removed, so it is not from 5.2.1.

Not proved: Meta's real pop-up, which needs ReapLift's Meta app with an HTTPS address in its allowed domains (E3), and credit-line sharing against real Meta (E7).
