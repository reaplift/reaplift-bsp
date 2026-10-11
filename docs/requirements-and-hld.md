# ReapLift WhatsApp BSP: High-Level Requirements and Design

Version 1, 10 October 2026. Agreed in a design brainstorm; no code written yet.

**How to use this file in a new session:** treat sections 1 to 11 as decided. Section 12 lists what is assumed or still open; do not treat those as decided. Anything not in this file has not been discussed.

---

## 1. Background

- ReapLift Pvt. Ltd. is a marketing company in India that runs WhatsApp promotions for its clients.
- Today it sends through a third-party provider, Dovesoft, using Dovesoft's panel.
- Goal: build ReapLift's own WhatsApp platform, white-labelled as ReapLift, working directly with Meta, and replace Dovesoft.
- ReapLift's Meta business is already verified.
- Phase 1 is marketing and promotional (template) messaging. Two-way messaging comes later.
- Stack chosen by the owner: Node.js backend, React frontend.
- Priority: backend and Meta connectivity first. UI can be improved later.

## 2. Business model

- ReapLift pays Meta and resells to clients at its own prices.
- Each client has a **prepaid wallet in rupees**.
- Each client has its own **price per message type**: marketing, utility, authentication.
- Clients never see Meta's rates. Only the super user sees Meta cost and margin.
- Volume: about 25K messages a week at launch, growing to a maximum of about 200K.

### Meta partner route

- A credit line for reselling requires Meta **Solution Partner** status. The path is Tech Provider first, then Solution Partner after a track record.
- **At launch:** client WhatsApp accounts sit under ReapLift's Meta business and Meta bills ReapLift's card.
- **Later:** when Meta approves the credit line, it is attached to client accounts. Nothing changes for clients.
- "Who pays Meta" is therefore a setting on each client WhatsApp account (ReapLift card, partner credit line, ReapLift credit line).
- ReapLift must create its **own Meta developer app** and get it reviewed for WhatsApp messaging and account management. This is separate from the Dovesoft setup and should start in parallel with the build.

## 3. Users and roles

| Role                                | Can do                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Super user                          | Sees the real Meta picture: Meta cost, billed amount, margin, number quality and limits, raw Meta errors. Manages clients, price lists, wallets, rules, charging switches, staff. |
| Marketing employee (ReapLift staff) | Runs campaigns and views reports for the clients assigned to them.                                                                                                                |
| Client                              | Sees only their own dashboard, templates, campaigns, reports and wallet, at their own prices.                                                                                     |

## 4. Scope

### Phase 1

- Client panel in the same layout as the existing Dovesoft panel, purple ReapLift branding.
  - Existing sidebar for reference: Home, Dashboard, Push Campaign, Reports, Templates, Extra Report, Settings, Chat Settings (Quick Replies, Chat Assign), Automation, API Information.
  - Existing dashboard: four tiles (Yesterday, Last 15 Days, This Month, Last Month) each showing spend and count; day-wise consumption bar chart; WhatsApp account box (number, display name, quality, message limit).
- Push Campaign with audience by upload: Excel, CSV, or a Google Sheet link shared for viewing. Column mapping for mobile number and template values.
- Templates: create, submit to Meta, track approval.
- Reports: dashboard figures, month-wise campaign summary, per-number campaign report, download.
- Wallet, price lists, top-ups, refunds.
- Rules engine and charging switches, editable by the super user.
- Super-user Meta view.
- Connecting a client's number through Meta's sign-up; moving existing numbers from Dovesoft.

### Phase 2 and later

- Public API for campaigns and single sends, with API keys per client.
- Integration with ReapLift's own marketing CRM. The CRM is written in PHP and maintained by a third party. It sends to Dovesoft today and will add ReapLift as a second provider; the CRM side handles its own integration work. The CRM should also be able to pull reports. Details to be decided in phase 2.
- Audience from a database query; private Google Sheets.
- Log cleanup after 180 days with archive to object storage and a download screen.
- "Resend to numbers that hit Meta's limit" option.
- Chat inbox, quick replies, chat assignment, automation.

## 5. Charging policy (locked)

| Outcome for a number                     | Meta charges ReapLift | Client charged                      |
| ---------------------------------------- | --------------------- | ----------------------------------- |
| Blocked by rules or history (never sent) | No                    | Yes, shown as blocked with a reason |
| Sent, not delivered                      | No                    | Yes                                 |
| Delivered or read                        | Yes                   | Yes                                 |
| Failed at Meta                           | No                    | No, refunded to the wallet          |

- The wallet is charged for all numbers when the campaign is confirmed. Failures are refunded as Meta reports them.
- Before confirming, the user sees a summary: how many will send, how many are blocked or invalid, and the total charge.
- Each outcome is a yes/no switch the super user can change, for all clients or one client, without code changes.
- If the wallet balance is short, nothing is sent.

## 6. Rules

- Meta has no fixed "no duplicate within X hours" rule. Meta enforces its own per-person marketing limit across all businesses and rejects those messages with a specific reason. ReapLift cannot predict or prevent these; they are shown clearly as a Meta limit.
- ReapLift has no specific rule requirement at launch. The requirement is that rules can be added and changed later with minimal code change through a simple admin tool.
- Design: each rule is a settings row (type, values, applies to all clients or one, on or off) plus one small function in the code per rule type. The super user changes values and switches in the admin screen; changes apply from the next campaign.
- Starting rule types:
  - Skip opted-out numbers (always on)
  - No repeat of the same template to a number within X hours (off at launch)
  - At most N marketing messages per number per day or week (off at launch)
  - Quiet hours (off at launch)
  - Pause sending if number quality drops to Low (on)
- Opt-out is per client: a STOP to one client does not block that customer for other clients.

## 7. Hosting

- **Oracle Cloud (OCI), Mumbai region, Pay As You Go account** (not free-tier-only, to avoid idle reclaim and capacity problems while keeping the free allowance).
- One ARM server running containers. Expected cost is near zero to low thousands of rupees a month; prices quoted in discussion were estimates from memory and must be checked.
- Domain with HTTPS (for example `wa.reaplift.com`). Meta requires a secure public address for delivery updates.
- OCI Object Storage for uploaded sheets, template media and nightly database backups. It uses the same interface as S3.

## 8. Architecture

```
Browser ──► Web gateway ──► React panel
                       └──► Node API ◄──► PostgreSQL ◄──► Sender worker ──► Meta WhatsApp API
                                              ▲
                              Status receiver ┘ ◄── Meta delivery updates
Object storage: uploads, media, backups
```

| Part                  | Job                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| React panel           | Client, staff and super-user screens                                                     |
| Node API (TypeScript) | Logins, roles and all business logic                                                     |
| Sender worker         | Picks up queued messages, sends to Meta at a controlled rate, retries temporary failures |
| Status receiver       | Accepts Meta's updates, verifies them, updates messages, triggers refunds                |
| Scheduler             | Starts scheduled campaigns; syncs template approvals and number quality from Meta        |
| PostgreSQL            | All records, and the message queue                                                       |

Decisions:

- **No Redis in phase 1.** The `messages` table is the queue: rows are saved as "queued" and the worker takes them in batches using PostgreSQL row locking. Rule lookups are indexed queries on the same table.
- Wallet charge and message queueing happen in one database transaction.
- The sender worker is a separate process from the API. API, worker, receiver and scheduler are one codebase started in different modes.
- **API-first:** the panel uses the same backend endpoints the CRM will use in phase 2. Campaign creation accepts "a list of numbers with values" from any source; each message records its source (panel upload, API, CRM).
- Redis would be added only for the phase 2 chat inbox or volumes far above 200K.

## 9. Data

| Table           | Key contents                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`       | Name, status, contact, low-balance alert level                                                                                                                                                           |
| `users`         | Name, email, password hash, role, client                                                                                                                                                                 |
| `staff_clients` | Which staff member handles which clients                                                                                                                                                                 |
| `wa_accounts`   | Client, Meta account ID, number, display name, encrypted access key, quality, daily limit, who pays Meta                                                                                                 |
| `templates`     | Client, name, language, category, content, variables, Meta approval status                                                                                                                               |
| `lists`         | Client, name, source file, total and valid counts                                                                                                                                                        |
| `list_contacts` | List, number, column values for template variables                                                                                                                                                       |
| `opt_outs`      | Client, number, date, how they opted out                                                                                                                                                                 |
| `campaigns`     | Client, template, list, schedule time, status, running totals (total, blocked, sent, delivered, read, failed), total charge                                                                              |
| `messages`      | Campaign, client, number, status, time of each stage (queued, sent, delivered, read), block or failure reason, Meta error code, Meta message ID, client price, Meta cost, source, created date (indexed) |
| `price_lists`   | Client, message type, price per number                                                                                                                                                                   |
| `wallet_ledger` | Client, entry type (top-up, charge, refund), amount, balance after, campaign, who did it, date. Entries are only added, never edited.                                                                    |
| `rules`         | Rule type, values, client (blank means all), on or off                                                                                                                                                   |
| `charge_policy` | Client (blank means all), which outcomes are charged                                                                                                                                                     |
| `meta_events`   | Every raw update from Meta, received time, processed flag                                                                                                                                                |
| `audit_log`     | Who changed what and when                                                                                                                                                                                |

- Every table carries the client ID and every query is filtered by it.
- Phase 2 adds `api_keys` and `client_callbacks`.

### Retention

- Phase 1: no cleanup. All per-number logs stay in the live database (estimated at most about 20 GB after six months at 200K a week).
- Phase 2: per-number logs and raw Meta events older than **180 days** are written to compressed files in object storage (one per client per month), verified, then deleted from the database. The super user can download an archived month as a file.
- Never deleted: wallet ledger, campaign summaries, invoices.

## 10. Main flows

**Setup**

1. Super user creates the client, sets its prices, connects its number, tops up the wallet.
2. Client or staff creates a template; it goes to Meta for approval.

**Campaign**

1. User picks a template, uploads the sheet, maps columns.
2. The system cleans and validates the numbers and checks each against active rules: will send, blocked, or invalid.
3. User sees the summary and total charge, and confirms.
4. In one transaction the wallet is charged for all numbers and the messages are queued.
5. The worker sends each message and stores Meta's message ID.

**Delivery updates**

1. Meta calls the status receiver with sent, delivered, read or failed.
2. The receiver checks Meta's signature, saves the raw update, ignores repeats, and updates the message and campaign totals.
3. On delivered, the Meta cost is recorded. On failed, the client's charge is refunded.

**Reports**

- Client sees counts and their own charge. Super user also sees Meta cost and margin.

## 11. Meta connectivity

**Calls to Meta**

| Purpose                             | When                                          |
| ----------------------------------- | --------------------------------------------- |
| Send a template message             | Per queued number, by the worker              |
| Create, list, delete templates      | On submit; synced on a schedule               |
| Upload media                        | Template with image, video or document header |
| Read number quality and daily limit | On a schedule                                 |
| Register a client's number          | Onboarding through Meta's sign-up             |

**Updates from Meta**

| Update                              | Action                                          |
| ----------------------------------- | ----------------------------------------------- |
| Sent, delivered, read               | Update message and campaign totals              |
| Failed with error code              | Record reason, refund wallet                    |
| Template approved, rejected, paused | Update status, notify client                    |
| Number quality or limit changed     | Update account; pause sending if quality is low |
| Customer reply such as STOP         | Record opt-out; full replies handled in phase 2 |

**Worker handling**

- Accepted: save Meta's message ID, mark sent.
- Temporary problem (Meta busy, rate limit, network): retry with growing gaps, limited attempts.
- Permanent problem (bad number, template paused): mark failed with reason, refund, no retry.
- Account-level problem (invalid access key, payment issue, number blocked): pause the whole campaign and alert the super user.

**Reliability and protection**

- Raw updates are saved before processing and can be replayed.
- Status only moves forward; duplicate and out-of-order updates are handled.
- A refund is tied to the message ID and can happen only once.
- Sending speed is a setting per client account.
- Passwords hashed; role checks on every request; Meta access keys encrypted; nightly backups.

**Backend API groups (phase 1)**

Login and users; clients and accounts; templates; lists; campaigns (create, summary, confirm, schedule, pause, cancel); reports; wallet and prices; rules and charging; Meta receiver.

**Build order**

1. Server setup, logins, roles, clients
2. Connect a number; templates synced with Meta
3. Upload, lists, campaign creation and summary
4. Sending, delivery updates, rules
5. Price lists, wallet, refunds
6. Reports and export; super-user Meta view
7. Pilot with one client moved from Dovesoft

---

## 12. Assumed or open (not decided)

| Item                                                                                                         | Status                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Each client has its own number and WhatsApp account, not shared between clients                              | Asked several times, never confirmed. The design assumes it.                 |
| Invalid numbers in an upload are charged like blocked ones                                                   | Assumed from "blocked or skipped numbers are still charged".                 |
| ReapLift's own Meta developer app                                                                            | Not confirmed whether it exists. Needed before any sending.                  |
| Exact Meta requirements and timeline for Solution Partner and the credit line                                | Not verified against Meta's current partner documentation.                   |
| Whether templates carry over when a number moves from Dovesoft                                               | Not verified; plan for re-submission.                                        |
| Dovesoft's exact charging rule                                                                               | Unknown. See section 13. The owner chose the policy in section 5 regardless. |
| "200K maximum"                                                                                               | Taken as per week, like the 25K figure. Not explicitly stated.               |
| Merging `status` and `delivery_status` into one column in the per-number report                              | Proposed, not confirmed.                                                     |
| Funnel-style counts in reports (delivered includes read)                                                     | Proposed, not confirmed.                                                     |
| How long archives are kept                                                                                   | Proposed indefinitely; phase 2 decision.                                     |
| Node web framework, React UI library, login method details                                                   | Not discussed.                                                               |
| Low-balance alerts, invoices and GST handling, wallet top-up method (manual by super user or online payment) | Mentioned only in passing; not designed.                                     |
| Meta's per-message rates in rupees                                                                           | Not verified. Figures used in the mockup are placeholders.                   |

## 13. Reference: existing Dovesoft reports

**Month-wise summary** (file `SummaryDataMonthWise`): columns Sr No., Month, Year, User Id, Campaign Name, Total Count, Pending, Failed, Blocked, Sent, Delivered, Not Delivered, DR Not Available, Read Count, Total Unit.

Sample, client KSTEWD, August 2026:

| Campaign            | Total | Sent  | Delivered | Read  | Total Unit |
| ------------------- | ----- | ----- | --------- | ----- | ---------- |
| Pymt_Reminder_Aug27 | 2,652 | 2,652 | 827       | 1,627 | 325        |
| Pymt_Reminder_Aug26 | 1,311 | 1,311 | 460       | 732   | 158.6      |
| Pymt_Reminder_Aug20 | 1,312 | 1,312 | 473       | 718   | 158.99     |

- Delivered and Read are separate buckets (each message counted in its latest status), which is why Read exceeds Delivered.
- Dividing Total Unit by ₹0.13 gives whole numbers (2,500; 1,220; 1,223), each about 94% of the total. This suggests a ₹0.13 rate and that Dovesoft does not charge for every number. Both points are inferences from three rows, not confirmed.

**Per-number campaign report** (file `Reaplift_record1`): columns `sr_no`, `mobile_no`, `reason`, `status`, `sent_time`, `delivery_status`, `delivery_time`, `read_time`, `que_time`. Times are in dd/mm/yyyy hh:mm:ss.

Sample, one campaign on 9 October 2026, 675 numbers:

| Result                  | Numbers |
| ----------------------- | ------- |
| Read                    | 160     |
| Delivered, not read     | 203     |
| Sent, no further update | 11      |
| Failed                  | 301     |

Failure reasons: 199 "This message was not delivered to maintain healthy ecosystem engagement" (Meta's per-person marketing limit); 91 "Message undeliverable"; 11 "User's number is part of an experiment". `status` was "sent" on every row including failures. All 675 were handed to Meta within about four seconds.

## 14. Related file

- `reaplift-panel-mockup.html`: clickable mockup with example figures of four new screens (super-user Meta view, rules and charging, campaign confirmation, client wallet and prices). Also published at https://claude.ai/artifact/SW2hi7wpsQ5FHs4xpFDf1L
