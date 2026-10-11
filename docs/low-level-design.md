# ReapLift WhatsApp BSP: Low-Level Design

Oct 11, 2026 · @Nikhila

## Defaults this design picks

This design builds on the requirements and HLD of 10 October 2026 (sections 1 to 11 treated as decided). Where the HLD left a choice open, this document picks a default below; each can be changed before milestone 0 starts without affecting anything else in the plan.

| Area               | Default                                                                                                     | Why                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Repository         | One private GitHub repo `reaplift-bsp` (https://github.com/reaplift/reaplift-bsp), pnpm workspaces monorepo | Panel, server and shared types change together; one pipeline      |
| Language           | TypeScript everywhere, Node.js 22 LTS                                                                       | HLD says Node API in TypeScript and React panel                   |
| API framework      | Fastify, with Zod for request validation                                                                    | Fast, typed, built-in raw-body access needed for Meta signatures  |
| Database access    | Kysely (typed SQL builder) with plain SQL migrations                                                        | Queue locking needs hand-written SQL; an ORM would get in the way |
| Panel              | React + Vite, served as static files                                                                        | HLD stack; UI polish later                                        |
| Logging            | pino JSON logs to stdout, collected by Docker                                                               | No extra service needed                                           |
| Tests              | Vitest; integration tests against a real PostgreSQL 16 in CI                                                | The queue and ledger rely on real row locking                     |
| Container registry | GitHub Container Registry (GHCR)                                                                            | Lives next to the code; no extra account                          |
| HTTPS gateway      | Caddy                                                                                                       | Gets and renews the certificate automatically                     |
| Server             | One OCI Ampere (ARM) VM, Mumbai, Ubuntu 24.04, Docker Compose                                               | HLD section 7                                                     |
| Address            | `wa.reaplift.com`                                                                                           | Example from the HLD; confirm the real name                       |

One codebase, one image: the server image starts as `api`, `worker`, `receiver`, `scheduler` or `migrate` depending on a `MODE` setting, as the HLD requires.

## Milestone 0: Foundation

Milestone 0 is accepted when a commit merged to `main` is live at `https://wa.reaplift.com` with no manual step, and `https://wa.reaplift.com/healthz` shows that commit's ID. Nothing in this milestone talks to Meta.

**Order changed on 11 October 2026:** the work starts on the laptop and GitHub. Tasks 0.1, 0.2, 0.3 and 0.7 come first, with everything running locally under Docker Compose and CI on GitHub. Oracle Cloud tasks 0.4, 0.5, 0.6 and 0.8 follow later. Until then, the milestone check is a green CI run on `main` and `/healthz` answering locally.

### Repository layout

```
reaplift-bsp/
  apps/
    server/            Node + Fastify; one entry point, MODE picks api | worker | receiver | scheduler | migrate
      src/modes/       one file per mode
      src/modules/     auth, clients, accounts, templates, lists, campaigns, wallet, rules, reports, meta
      src/lib/         db, config, logger, crypto, meta-client
      test/            unit and integration tests
    web/               React + Vite panel (static build)
  packages/
    shared/            Zod schemas and types shared by server and panel
  db/
    migrations/        numbered plain SQL files: 0001_init.sql, 0002_...
  infra/
    compose.prod.yml   services on the server
    Caddyfile          HTTPS and routing
    bootstrap.sh       one-time server setup
    backup.sh          nightly database backup to Object Storage
  .github/workflows/
    ci.yml             every pull request and push
    deploy.yml         every push to main
  Dockerfile           one image for server + built panel
```

### What runs on the server

| Container | Image                                   | Job                                                                                                         | Reachable from                      |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| caddy     | `caddy:2`                               | HTTPS certificate, routes `/api/*` to api, `/webhooks/meta` to receiver, everything else to the panel files | Internet, ports 80 and 443          |
| api       | `reaplift-bsp:<commit>` with `MODE=api` | Panel and future CRM endpoints                                                                              | caddy only                          |
| receiver  | same image, `MODE=receiver`             | Meta delivery updates (added in milestone 1)                                                                | caddy only                          |
| worker    | same image, `MODE=worker`               | Sends queued messages (milestone 1)                                                                         | no inbound traffic                  |
| scheduler | same image, `MODE=scheduler`            | Timed jobs: template and quality sync, scheduled campaigns (milestone 3 onward)                             | no inbound traffic                  |
| postgres  | `postgres:16`                           | All data and the queue; data on a separate block volume                                                     | containers only, never the internet |

The receiver is its own container so a busy panel never delays Meta's updates, and a panel deploy can restart the api without dropping webhooks.

### Pipeline

(Diagram in the online version: merge to main → CI green → push ARM64 image → migrate, restart → health check shows the new commit? yes: live; no: roll back, job fails.)

A commit goes live only after CI passes and the server reports its ID on `/healthz`; otherwise the previous image comes back.

1. Every pull request and push runs `ci.yml`: install, lint, type-check, unit tests, integration tests against a PostgreSQL 16 service container, panel build, image build (not pushed).
2. `main` is protected: a merge needs a green CI run.
3. A push to `main` runs `deploy.yml`: build the ARM64 image, tag it with the commit ID, push it to GHCR.
4. The job connects to the server over SSH as the `deploy` user and runs `infra/deploy.sh <commit>`.
5. `deploy.sh` pulls the image, runs `MODE=migrate` once, then restarts api, receiver, worker and scheduler with `docker compose up -d`.
6. The job polls `/healthz` until it reports the new commit ID and `db: ok`. If that fails, `deploy.sh` restarts the previous commit's image and the job goes red.

Migrations only add things (new tables, new nullable columns) so the previous image keeps working if a rollback happens after a migration. Removing a column takes two releases.

### One-time server setup

- OCI VM shape `VM.Standard.A1.Flex`, 2 OCPU and 12 GB to start, Ubuntu 24.04 ARM, in Mumbai. This sits inside the always-free ARM allowance as I remember it (4 OCPU, 24 GB); check current OCI terms.
- A separate block volume for PostgreSQL data, so the VM can be rebuilt without touching data.
- A reserved public IP, and a DNS A record for `wa.reaplift.com` pointing at it.
- OCI security list opens 80 and 443 to all, and 22 for SSH with key-only login and fail2ban. Oracle's Ubuntu images also ship host firewall rules that block 80 and 443; `bootstrap.sh` opens them.
- `deploy` user in the `docker` group; `/opt/reaplift` holds `compose.prod.yml`, `Caddyfile`, and `.env` (mode 600).
- Object Storage bucket `reaplift-bsp-backups` with a 30-day delete rule, reached through its S3-compatible endpoint with a Customer Secret Key.

### Settings and secrets

| Setting                                | Lives in               | Used by                                      |
| -------------------------------------- | ---------------------- | -------------------------------------------- |
| SSH host, deploy key, known-hosts line | GitHub Actions secrets | deploy job                                   |
| GHCR pull token (read-only)            | server `.env`          | docker on the server                         |
| `DATABASE_URL`, Postgres password      | server `.env`          | all modes                                    |
| `APP_ENCRYPTION_KEY` (32 bytes)        | server `.env`          | encrypting Meta access keys from milestone 1 |
| Object Storage access key and secret   | server `.env`          | `backup.sh`                                  |
| Meta app secret, webhook verify token  | server `.env`          | receiver, from milestone 1                   |

No secret goes in the repository. `.env.example` lists every name with a blank value.

### Health check

`GET /healthz` returns `{ "status": "ok", "version": "<commit>", "db": "ok" }`, and a 503 if the database cannot be reached. It is the deploy job's success signal and the target for a free uptime monitor later.

### Tasks

| ID  | Task                                                                                                                | Tests                                                          | Accepted when                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0.1 | Create the repo and the skeleton above, with `api` mode serving `/healthz` and the panel showing a placeholder page | Unit test for `/healthz` with the database up and down         | `pnpm test` and `pnpm build` pass locally                                                         |
| 0.2 | `ci.yml` and branch protection on `main`                                                                            | A deliberately failing test blocks a merge                     | Pull requests show a CI check; red blocks merge                                                   |
| 0.3 | `Dockerfile` (multi-stage, ARM64) and `compose.prod.yml`                                                            | Image starts in CI and answers `/healthz`                      | `docker compose up` works on a laptop                                                             |
| 0.4 | Provision VM, block volume, reserved IP, DNS, firewall with `bootstrap.sh`                                          | Script is re-runnable without harm                             | `ssh deploy@wa.reaplift.com` works with the key only                                              |
| 0.5 | Caddy with HTTPS and routing                                                                                        | `curl -I http://...` redirects to HTTPS                        | Browser shows a valid certificate for `wa.reaplift.com`                                           |
| 0.6 | `deploy.yml` and `deploy.sh` with health wait and rollback                                                          | A commit with a broken `/healthz` rolls back and the job fails | **Milestone check:** a one-line change merged to `main` appears at `/healthz` with no manual step |
| 0.7 | Migration runner and `0001_init.sql` (a `schema_migrations` table only)                                             | Running migrate twice changes nothing                          | Deploy log shows migrations applied before restart                                                |
| 0.8 | Nightly `backup.sh` (pg\_dump, gzip, upload) on a systemd timer, plus a restore drill                               | Restore of last night's file into a scratch database           | A restored copy matches row counts of the live database                                           |

### Needed from ReapLift

- Access to the OCI Pay As You Go account (or someone to create the VM and bucket with the script).
- DNS control for `reaplift.com` to add the `wa` record, or the final address if different.
- The GitHub account or organisation the repo should live in.

## Milestone 1: One message end to end

Milestone 1 is accepted when one command on the server sends an approved template to a real phone, and that message's row in `messages` then shows its Meta message ID and its sent, delivered and read times. It uses one test client, one number and one template; wallet, rules, campaigns and panel screens come later.

### Meta setup (ReapLift, outside the code)

1. Create ReapLift's own Meta app (type Business) under the verified business and add the WhatsApp product. The HLD lists this as not yet confirmed; nothing can be sent without it.
2. Start with Meta's free test number, which comes with the approved `hello_world` template and can message a handful of verified recipient phones (limits from memory; check the dashboard). A real spare number that is not on Dovesoft also works.
3. In Business Manager, create a system user, give it the app and the WhatsApp account, and generate a permanent token with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. In the app's WhatsApp settings, set the callback URL to `https://wa.reaplift.com/webhooks/meta` with the verify token from `.env`, and subscribe to the `messages` field.
5. Real (non-test) webhooks may need the app in Live mode, which needs a privacy policy URL. Check this when setting up; it is not verified.

ReapLift hands over the app ID, app secret, WhatsApp account ID, phone number ID and token. The token is entered once through a command and stored encrypted, never in a file.

### Tables added (migration 0002)

Money is stored as whole paise in `bigint` columns so rupee sums never round. Numbers are stored as digits with country code and no plus sign (`9198xxxxxxxx`).

```sql
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','suspended')),
  contact_email text,
  low_balance_alert_paise bigint,
  created_at timestamptz not null default now()
);

create table wa_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone text not null,
  display_name text,
  access_token_enc bytea not null,          -- AES-256-GCM: iv + tag + ciphertext
  quality_rating text,
  messaging_limit text,
  meta_payer text not null default 'reaplift_card'
    check (meta_payer in ('reaplift_card','partner_credit_line','reaplift_credit_line')),
  send_rate_per_sec int not null default 20,
  status text not null default 'active' check (status in ('active','paused')),
  paused_reason text,
  created_at timestamptz not null default now()
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  wa_account_id uuid not null references wa_accounts(id),
  meta_template_id text,
  name text not null,
  language text not null,
  category text not null check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  components jsonb not null,
  variable_count int not null default 0,
  status text not null,                     -- APPROVED, PENDING, REJECTED, PAUSED, DISABLED
  updated_at timestamptz not null default now(),
  unique (wa_account_id, name, language)
);

create table messages (
  id bigint generated always as identity primary key,
  client_id uuid not null references clients(id),
  wa_account_id uuid not null references wa_accounts(id),
  campaign_id uuid,                          -- foreign key added with campaigns
  template_id uuid not null references templates(id),
  to_number text not null,
  variables jsonb not null default '[]',
  status text not null default 'queued'
    check (status in ('queued','sending','sent','delivered','read','failed','blocked')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  meta_message_id text unique,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  block_reason text,
  failure_reason text,
  meta_error_code int,
  pricing_category text,
  billable boolean,
  client_price_paise bigint,
  meta_cost_paise bigint,
  source text not null default 'panel' check (source in ('panel','api','crm','cli')),
  created_date date not null default current_date
);
create index messages_queue_idx on messages (next_attempt_at) where status = 'queued';
create index messages_client_date_idx on messages (client_id, created_date);
create index messages_rule_idx on messages (client_id, to_number, created_date);

create table meta_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  body jsonb not null,
  processed_at timestamptz,
  process_error text
);
create index meta_events_todo_idx on meta_events (id) where processed_at is null;

create table message_status_events (          -- one row per (message, status): stops repeats
  meta_message_id text not null,
  status text not null,
  meta_timestamp timestamptz not null,
  meta_event_id bigint not null references meta_events(id),
  primary key (meta_message_id, status)
);
```

### Sender worker

1. Claim a batch in one short transaction:

```sql
update messages set status = 'sending', locked_at = now(), attempts = attempts + 1
where id in (
  select id from messages
  where status = 'queued' and next_attempt_at <= now()
  order by id limit 50
  for update skip locked)
returning *;
```

2. For each row, wait on that account's rate limiter (`send_rate_per_sec`, a token bucket in memory), then call `POST https://graph.facebook.com/<version>/<phone_number_id>/messages` with a `template` body built from the template's name, language and the row's `variables`. The Graph API version is a setting, pinned in `.env`.
3. Record the outcome in one update per row:

| Meta's answer                         | Examples (codes from memory, checked when coding)          | Row becomes                                                                                   |
| ------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Accepted with a message ID            | 200 with `messages[0].id`                                  | `sent`, `meta_message_id` and `sent_at` saved                                                 |
| Temporary                             | network error, timeout, HTTP 5xx, 4, 80007, 130429, 131056 | `queued` again, `next_attempt_at` = now + 30 s × 2^(attempts − 1); after 5 attempts, `failed` |
| Permanent for this number or template | 100, 131009, 131026, 132000, 132001, 132015                | `failed` with reason and code                                                                 |
| Account-level                         | 190 (bad token), 131031 (account locked), 131042 (payment) | row back to `queued`, account set to `paused` with the reason, alert logged                   |

The code-to-class mapping is one table in `meta/errors.ts`, so a new code is a one-line change. Paused accounts are skipped when claiming.

A row stuck in `sending` for more than 5 minutes means the worker stopped mid-call. Meta's send call has no repeat protection, so resending could deliver twice. Stuck rows are logged and alerted, never resent automatically; the super user decides.

### Status receiver

- `GET /webhooks/meta` answers Meta's subscription check: if `hub.verify_token` matches the setting, it returns `hub.challenge`; otherwise 403.
- `POST /webhooks/meta` reads the raw body (up to 1 MB), computes HMAC-SHA256 with the app secret and compares it with `X-Hub-Signature-256` in constant time. A mismatch returns 401 and stores nothing. A match inserts the body into `meta_events` and returns 200 at once.
- A processing loop in the same container claims unprocessed events with `for update skip locked` and handles each `statuses[]` entry:
  1. Insert into `message_status_events`; if the row already exists, it is a repeat and is skipped.
  2. Find the message by `meta_message_id`. If it is missing (the update beat the worker's save), the event stays unprocessed and is retried; after 10 minutes it is marked with an error.
  3. Apply the status forward only, by rank: queued 0, sending 1, sent 2, delivered 3, read 4. A higher rank moves the status; a lower one only fills its missing time. `read` also fills `delivered_at` if it is empty.
  4. `failed` applies only while the message is below delivered, and saves the error code and title (for example 131049, Meta's per-person marketing limit).
  5. Save `pricing.category` and `pricing.billable` when present.
- Template, quality and incoming-message updates are stored in `meta_events` now and handled from milestone 3.

### Commands

| Command                                                           | Does                                                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `seed-account`                                                    | Creates the test client, its WhatsApp account (prompts for the token and stores it encrypted) and syncs its templates from Meta |
| `send-test --to 9198xxxxxxxx --template hello_world --lang en_US` | Queues one message with source `cli`; the worker sends it                                                                       |
| `show-message <id>`                                               | Prints the row and its status history                                                                                           |

Each runs on the server as `docker compose run --rm api <command>`.

### Tests

- Unit: signature check (valid, altered body, missing header); every status pair, including repeats and read before delivered; error classifier; template body builder.
- Integration, against real PostgreSQL and a fake Meta server: two workers running together never send the same row; 429 then 200 retries once and succeeds; a permanent error fails without retry; a 190 pauses the account; the same webhook delivered three times changes the row once; a webhook that arrives before the worker's save is applied on retry.

### Tasks

| ID  | Task                                                                           | Tests                                             | Accepted when                                                                                                                |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Meta app, number, system user token, webhook settings (ReapLift with guidance) | None in code                                      | Meta's dashboard verifies the callback URL against the live receiver                                                         |
| 1.2 | Migration 0002                                                                 | Migrate on an empty and on a milestone 0 database | Tables exist on the server after a deploy                                                                                    |
| 1.3 | Encryption helper and `seed-account`                                           | Encrypt and decrypt round trip; wrong key fails   | The account row holds an encrypted token and `hello_world` appears in `templates`                                            |
| 1.4 | Meta client and error classifier                                               | Unit tests above                                  | Fake-server tests pass in CI                                                                                                 |
| 1.5 | Sender worker container                                                        | Integration tests above                           | Worker runs on the server and claims nothing when the queue is empty                                                         |
| 1.6 | Receiver endpoint and Caddy route                                              | Signature tests                                   | A tampered POST gets 401; Meta's test webhook from the dashboard is stored                                                   |
| 1.7 | Event processor                                                                | Status and repeat tests                           | Replaying a stored event changes nothing                                                                                     |
| 1.8 | `send-test` and `show-message`                                                 | None beyond the above                             | **Milestone check:** the phone shows the message, and `show-message` shows sent, delivered and read times after it is opened |

## Milestones 2 to 8: the build order as tasks

Each remaining step of the HLD build order becomes one milestone. "Server setup" from step 1 is already done in milestone 0. Every task ships with its tests in the same pull request, and CI must be green before it merges.

The HLD order puts wallet charging (milestone 6) after sending (milestone 5). Until milestone 6 lands, campaigns run only for the internal test client, never for a paying client.

### Milestone 2: Logins, roles, clients

Accepted when the super user creates a client and a client login, that client sees only its own empty dashboard, and a staff member sees only the clients assigned to them.

| ID  | Task                                                                                                                                               | Tests                                                                                             | Accepted when                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 2.1 | `users` and `sessions` tables; login with argon2id password hashes; session in an httpOnly, secure cookie, stored server-side so it can be revoked | Wrong password; 10 failures in 15 minutes locks the login for 15 minutes; logout ends the session | Super user logs in on the panel                                     |
| 2.2 | Request scope: every handler gets `{role, clientId, staffClientIds}` and every query function requires it                                          | A test walks every registered route as client A using client B's IDs and expects 404              | That test covers all routes, and a new route without scope fails CI |
| 2.3 | Clients, users and `staff_clients` screens and endpoints (super user only)                                                                         | Role checks per endpoint                                                                          | Super user can add a client, a client user and a staff assignment   |
| 2.4 | `audit_log` written on every change, with before and after values                                                                                  | A change to a client writes one audit row                                                         | Super user can see who changed what                                 |
| 2.5 | Panel shell: login page, purple layout, sidebar from the Dovesoft list, menus by role                                                              | Component tests for menu by role                                                                  | Each role sees its own menu; unbuilt pages show "coming soon"       |

### Milestone 3: Connect a number, templates synced with Meta

Accepted when a client's number is connected, a template submitted from the panel reaches Approved on screen without anyone refreshing it from Meta by hand, and a quality drop to Low pauses that number.

| ID  | Task                                                                                                                                     | Tests                                                                         | Accepted when                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 3.1 | Manual connect form for the super user (WhatsApp account ID, phone number ID, token), for numbers under ReapLift's business as at launch | Bad IDs or token are rejected after a test call to Meta                       | A second test number is connected from the panel                         |
| 3.2 | Meta Embedded Signup button for clients: exchange the returned code for a token, subscribe the app to the account, register the number   | Fake-server test of the code exchange and registration calls                  | Works once ReapLift's app is approved for it; until then 3.1 is the path |
| 3.3 | Template create and submit, including media headers (upload to Meta, keep the file in Object Storage)                                    | Body builder for each component type; variable count checks                   | Submitted template shows Pending with Meta's template ID                 |
| 3.4 | Template status from webhooks plus a 15-minute sync by the scheduler; in-panel notice on approve, reject or pause                        | Webhook and sync both update the same row once                                | A rejected template shows Meta's reason to the client                    |
| 3.5 | Number quality and limit from webhooks plus an hourly sync; Low pauses the account (the "pause on Low" rule)                             | Quality change Medium to Low pauses; back to Medium needs a super-user resume | Account box on the dashboard shows live quality and limit                |

### Milestone 4: Upload, lists, campaign creation and summary

Accepted when a Dovesoft-style sheet is uploaded, columns are mapped, and the summary shows the right counts for will send, blocked and invalid before anything is confirmed.

| ID  | Task                                                                                                                                                                | Tests                                                                                                     | Accepted when                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 4.1 | Upload Excel or CSV to Object Storage through a signed link; read a Google Sheet view link through its CSV export address                                           | Sample files with blank rows, merged headers, text-formatted numbers; a private sheet gives a clear error | Files up to 200K rows load into `lists` and `list_contacts`                           |
| 4.2 | Column mapping and number cleaning: default country India, strip spaces, plus and leading zero, drop repeats within the list, keep a reason for each invalid number | Table of raw inputs to expected results                                                                   | Invalid count and reasons match a hand-checked sample                                 |
| 4.3 | Campaign draft: template, list, mapping of each template variable to a column                                                                                       | A template with an unmapped variable cannot be saved                                                      | Draft shows a preview of the first rendered message                                   |
| 4.4 | Summary: rules run as set-based SQL over the whole list in dry-run mode, giving counts by outcome and reason, plus the total charge (prices arrive in milestone 6)  | 200K-row list on CI hardware; each rule type has a fixture                                                | Summary for 200K numbers returns within 30 seconds on the server (target, to confirm) |
| 4.5 | `POST /api/campaigns` takes `{templateId, contacts: [{number, values}], source}`; the panel uses the same endpoint                                                  | Contract test shared with the panel                                                                       | The same campaign can be created from the panel or with curl                          |

### Milestone 5: Sending, delivery updates, rules

Accepted when a campaign to about 20 internal phones, one of them opted out, delivers to the rest, shows that one as blocked with "opted out", and the campaign totals equal the per-message rows.

| ID  | Task                                                                                                                                                                                                        | Tests                                                                | Accepted when                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 5.1 | Confirm: in one transaction, rules run again, will-send rows go in as `queued` and blocked rows as `blocked` with a reason, campaign becomes `running`                                                      | Rules re-checked at confirm catch an opt-out added after the summary | 200K rows are queued in one transaction without timing out                           |
| 5.2 | Running totals on `campaigns`, changed in the same transaction as each message status change; campaign ends when nothing is queued or sending                                                               | Totals equal a count of rows after a randomised run                  | Totals on screen match the per-number report                                         |
| 5.3 | Pause, resume, cancel and schedule (adds `cancelled` status; the scheduler starts due campaigns)                                                                                                            | Pause stops claims within one batch; cancel leaves sent rows alone   | A scheduled campaign starts within a minute of its time                              |
| 5.4 | Rules engine: `rules` rows plus one SQL check per type (opt-out, no repeat within X hours, at most N marketing per day or week); quiet hours hold messages until the window opens rather than blocking them | Each type on and off, for all clients and for one                    | Super user changes a rule value in the admin screen and the next campaign follows it |
| 5.5 | Opt-outs: an incoming STOP is recorded for that client only; super user can upload an opt-out list                                                                                                          | STOP to client A does not block client B                             | A STOP from a test phone blocks the next campaign to it                              |
| 5.6 | Load test: 200K messages against the fake Meta server at the configured rate                                                                                                                                | No message sent twice; rate stays at the setting                     | Report of the run is saved in the repo                                               |

### Milestone 6: Price lists, wallet, refunds

Accepted when, with a ₹100 balance and a price of ₹0.80, a 50-number campaign with 5 Meta failures leaves the balance at ₹64 (₹100 − ₹40 + ₹4), and every step shows in the ledger.

| ID  | Task                                                                                                                                             | Tests                                                              | Accepted when                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 6.1 | `price_lists` and `charge_policy` tables and screens; outcome switches for all clients or one                                                    | Client-level switch overrides the global one                       | Super user sets a client's three prices               |
| 6.2 | `wallet_ledger`, append-only (a database trigger refuses update and delete); balance changes lock the client row so two at once cannot overspend | Two confirms at once with money for only one: exactly one succeeds | Top-up with a note shows in the client's wallet page  |
| 6.3 | Charge at confirm in the same transaction as queueing; short balance means nothing is queued                                                     | Short-balance campaign leaves no messages and no ledger row        | Confirm screen shows the charge and the balance after |
| 6.4 | Refund on Meta failure, per the policy; a unique key on (message, refund) makes it happen once                                                   | Same failure webhook three times refunds once                      | Refunds appear as ledger rows tied to the message     |
| 6.5 | Meta cost recorded on delivered and billable, from a `meta_rates` table the super user fills in (Meta's rupee rates are not yet verified)        | Cost by category                                                   | Super user sees cost per message                      |
| 6.6 | Nightly check: ledger sums match balances, and charges minus refunds match message prices                                                        | A planted mismatch raises an alert                                 | The check runs every night and is clean               |

### Milestone 7: Reports, export, super-user Meta view

Accepted when the reports for the milestone 6 test campaign match a hand count, downloads open in Excel, and a client login never sees Meta cost or margin.

| ID  | Task                                                                                                                 | Tests                                            | Accepted when                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| 7.1 | `daily_stats` table (client, date, category, counts, client charge, Meta cost) kept current by the scheduler         | Rebuild from `messages` equals the running table | Dashboard tiles and day-wise chart load fast for a client with 6 months of data |
| 7.2 | Dashboard: four tiles (Yesterday, Last 15 Days, This Month, Last Month), day-wise chart, account box                 | Date edges in India time                         | Matches the Dovesoft dashboard layout                                           |
| 7.3 | Month-wise campaign summary in Dovesoft's column order, with download                                                | Totals per row equal the campaign's messages     | File opens in Excel with the same headings as `SummaryDataMonthWise`            |
| 7.4 | Per-number campaign report with Dovesoft's columns, streamed as CSV or Excel                                         | 200K-row export without running out of memory    | Matches `Reaplift_record1` columns                                              |
| 7.5 | Super-user Meta view: Meta cost, billed amount and margin by client and day; quality and limits; Meta errors by code | Client and staff roles get 403                   | Margin for the test campaign equals price minus cost                            |

### Milestone 8: Pilot with one client moved from Dovesoft

Accepted when the pilot client runs its normal campaigns on ReapLift for two weeks with no fallback to Dovesoft, and the wallet check stays clean.

| ID  | Task                                                                                                                                                | Tests                                 | Accepted when                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| 8.1 | Alerts by email to the super user: account paused, stuck sending, updates unprocessed for 5 minutes, disk over 80%, backup missing, `/healthz` down | Each alert fires from a planted fault | All six fired once in a drill                      |
| 8.2 | Number move from Dovesoft: written runbook (Dovesoft releases the number, two-step PIN, register under ReapLift, re-submit templates)               | Run on one low-risk number first      | Runbook is followed start to end without surprises |
| 8.3 | Pilot client setup: prices, top-up, templates approved                                                                                              | None in code                          | Client logs in and sees its own data only          |
| 8.4 | First small campaign, compared with a similar Dovesoft campaign's report                                                                            | None in code                          | Delivery and read rates are in the same range      |
| 8.5 | Go or no-go review with the owner                                                                                                                   | None in code                          | Owner signs off to move the next client            |

## Open items

Milestone 0 can start as soon as the first three rows are answered; the rest are needed by the milestone shown.

| Item                                                       | Needed by   | Default if nobody decides                                     |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| GitHub account or organisation for the repo                | Milestone 0 | Decided: https://github.com/reaplift/reaplift-bsp             |
| OCI account access and who runs the server setup           | Milestone 0 | Script run by whoever has OCI access                          |
| Final web address                                          | Milestone 0 | `wa.reaplift.com`                                             |
| ReapLift's own Meta app exists (HLD open item)             | Milestone 1 | Create it at the start of milestone 1                         |
| Whether real webhooks need the app in Live mode            | Milestone 1 | Switch to Live with a privacy policy page                     |
| Exact Meta error codes and their meaning                   | Milestone 1 | Mapping table above, checked against Meta's docs while coding |
| Each client has its own number (HLD open item)             | Milestone 3 | Assumed yes, as in the HLD                                    |
| Invalid numbers charged like blocked ones (HLD open item)  | Milestone 6 | Charged, controlled by a switch                               |
| Quiet hours: hold or block                                 | Milestone 5 | Hold until the window opens                                   |
| Wallet top-up method                                       | Milestone 6 | Manual top-up by the super user                               |
| Meta's rupee rates                                         | Milestone 6 | Entered by the super user in `meta_rates`                     |
| Report counts: Dovesoft buckets or funnel (HLD open item)  | Milestone 7 | Dovesoft buckets in downloads, funnel on the dashboard        |
| Password reset by email                                    | Milestone 2 | Super user resets passwords at launch                         |
| Whether templates carry over from Dovesoft (HLD open item) | Milestone 8 | Plan to re-submit                                             |
