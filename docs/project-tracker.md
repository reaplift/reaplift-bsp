# Project tracker

This tracker is organized like a company execution plan:

- Milestone: a business outcome
- Task: a major delivery unit
- Subtask: a unit of work that can be assigned independently
- Acceptance criteria: definition of done for that unit

This file is the source of truth for what is active, what is blocked, and what is next. It is not a local-machine notes file.

## Delivery model

The system is built in milestone slices so each team member can work independently without waiting on a giant single branch or a vague requirement document.

See the architecture overview in [architecture-overview.md](architecture-overview.md) and the diagram in [architecture-diagram.svg](architecture-diagram.svg).

### System flow

1. Web panel submits requests to the API.
2. API validates input and routes to the database or worker.
3. Worker sends messages to Meta through the WhatsApp API.
4. Meta delivery updates are received and processed.
5. Reports, wallet impact, and campaign status are updated from the same data model.

### Product-critical flow and delivery order

The most important product journeys are not only "send a message" but also the campaign and dashboard paths that make the product operational for clients. The team should treat M1 to M7 as a single business flow, not isolated backend tasks:

- campaign creation and validation
- template + account binding
- send queue and message status
- wallet and refund correctness
- dashboard reporting and operational visibility

This means campaign and dashboard work should be spec-driven in parallel with the Meta receiver and worker work so the platform can be validated end-to-end even before the real Meta app is available.

### Spec-driven contract format

Every feature in this tracker must be defined like a product contract before code is written. That means each task or endpoint document includes:

- HTTP method and route
- auth / role requirements
- request schema with required fields and validation rules
- success response body
- failure response bodies and error codes
- side effects on the database or external systems
- state transitions and eventual consistency rules
- tests that prove the contract

Example contract pattern:

```
POST /api/v1/wa/accounts
Request:
{
  "clientId": "uuid",
  "wabaId": "1234567890",
  "phoneNumberId": "1234567890",
  "displayPhone": "919812345678",
  "displayName": "ReapLift Ops",
  "metaPayer": "reaplift_card"
}

Success 201:
{
  "id": "uuid",
  "clientId": "uuid",
  "status": "active",
  "displayPhone": "919812345678",
  "createdAt": "2026-10-18T12:00:00.000Z"
}

Error 400:
{
  "error": "INVALID_REQUEST",
  "message": "displayPhone must be digits with country code"
}
```

The implementation is considered correct only when the live code matches this contract exactly.

## Definition of ready for a task

A task is ready to start only when it satisfies all of the following:

- business goal and scope are written clearly
- exact API contract is defined: route, validation, success response, error responses
- data model and schema changes are documented
- client scope and authorization rules are written down
- state transitions and async flows are described
- retry, failure, and idempotency handling are defined
- tests are identified before coding starts
- reviewer agrees that the task is implementation-ready

## Must-have vs good-to-have

This project should separate the launch-critical path from the longer-tail optimization work.

### Must-have before internal beta
- client-scoped access and admin/staff roles
- WhatsApp account and template setup
- mock provider and live provider compatibility
- send queue and state processing
- campaign draft -> confirm -> queue flow
- basic wallet charge and refund handling
- dashboard summary DTOs and reports for daily / recent / monthly views
- multi-client data isolation and reporting correctness
- webhook processing and delivery status updates
- basic export and operational visibility

### Good-to-have after beta
- advanced scheduling rules and quiet hours
- large-volume optimization and queue tuning
- deep analytics dashboards and advanced cohort views
- UX polish and custom filters
- CRM automation integrations beyond the base API
- richer object storage and list processing features
- AI-assisted content or template optimization
- additional reporting exports and admin tooling

The core rule: if it affects campaign correctness, client isolation, wallet safety, or dashboard trust, it is must-have. If it improves polish or advanced analytics without affecting risk or correctness, it can be deferred.

## Milestone map

### M0. Foundation and repo readiness

Status: Done

#### 0.1 Repo and monorepo scaffold
- Status: Done
- Owner: repo setup
- Scope: monorepo layout, apps/server, apps/web, packages/shared
- Acceptance: repo builds locally and dev commands work

#### 0.2 CI and branch safety
- Status: Done
- Owner: repo setup
- Scope: lint, typecheck, test checks and review gate
- Acceptance: local validation is defined and CI protection is in place

#### 0.3 Local developer environment
- Status: Done
- Owner: devops/setup
- Scope: Docker, Postgres, migration flow, local dev commands
- Acceptance: app runs locally without manual patching

#### 0.7 Migration runner
- Status: Done
- Owner: backend
- Scope: SQL migration support and initial schema bootstrap
- Acceptance: `pnpm migrate` works and the initial schema is applied

#### 0.8 OCI / deployment readiness
- Status: Deferred
- Owner: infra
- Scope: OCI VM, deployment automation, production config
- Acceptance: to be handled when the server-side platform is ready

### M1. First real WhatsApp send flow

Status: In progress

#### 1.1 Meta app and number setup
- Status: Blocked externally
- Owner: ReapLift / Meta setup
- Scope: Meta app creation, WhatsApp business setup, token and number onboarding
- Acceptance: valid business app and number are available for real sending
- Dependency: external to the codebase

#### 1.2 Migration 0002: message and account schema
- Status: Done
- Owner: backend
- Spec: [m1-0002-migration-spec.md](m1-0002-migration-spec.md)
- Migration file: `0002_message_platform.sql`
- Scope:
  - 1.2.1 design the schema for clients, wa_accounts, templates, messages
  - 1.2.2 add the 0002 migration file
  - 1.2.3 validate migration locally and add schema tests
- Acceptance:
  - additive schema only
  - all tables include client_id and filtering rules
  - migration applies cleanly with `pnpm migrate`
  - test proves the table and column structure is correct
  - verified by the migration integration test and successful local Postgres run

#### 1.3 Encryption and seed account setup
- Status: Planned
- Owner: backend/security
- Scope: encrypt Meta keys, seed the first account, and validate account records
- Acceptance: account data can be stored safely and loaded by the server

#### 1.4 Meta client and error classifier
- Status: Planned
- Owner: backend
- Scope: Meta wrapper, request shaping, safe failure handling
- Acceptance: backend can call Meta endpoints and classify errors correctly

#### 1.5 Sender worker
- Status: Planned
- Owner: worker
- Scope: queue polling, send logic, retry policy, row locking
- Acceptance: a queued message is delivered to Meta and marked sent

#### 1.6 Receiver and webhook endpoint
- Status: Planned
- Owner: backend
- Scope: Meta status handler, webhook verification, raw event processing
- Acceptance: event updates are stored and message status moves forward

#### 1.7 Event processor and ledger updates
- Status: Planned
- Owner: backend
- Scope: mark delivered/read/failed, charge or refund wallet state
- Acceptance: state transitions are consistent and idempotent

#### 1.8 End-to-end send test
- Status: Planned
- Owner: QA + backend
- Scope: test the real send path from DB to Meta callback to campaign result
- Acceptance: one fully validated send path passes end-to-end

### M2. Logins, roles, clients, and access scope

Status: Planned

#### 2.1 Users and sessions
- Scope: create users, password hashing, session creation, secure cookie behavior
- Acceptance: valid login works; invalid login fails; session can be revoked

#### 2.2 Request scope and authorization
- Scope: every request gets role and client context; enforce client isolation and staff access rules
- Acceptance: client A cannot read or modify client B data

#### 2.3 Client and staff admin flows
- Scope: add and manage clients, users, staff-client assignments, audit logs
- Acceptance: super user can create and manage the entity graph

#### 2.4 Panel shell and menu by role
- Scope: login page, dashboard shell, sidebar, role-based menu
- Acceptance: different roles see only their allowed screens

### M3. Connected number, templates, and Meta sync

Status: Planned

#### 3.1 Manual number connection
- Scope: connect a WhatsApp number under ReapLift's business
- Acceptance: a second test number can be connected from the panel

#### 3.2 Embedded signup / token exchange
- Scope: client onboarding flow to exchange the returned code for a token and register a number
- Acceptance: onboarding works when Meta app approval is in place

#### 3.3 Template create and submit
- Scope: template authoring, media upload, Meta submission, variable mapping
- Acceptance: template reaches pending/approved status and view is correct

#### 3.4 Template sync and status updates
- Scope: webhooks and scheduler status sync for approved/rejected/paused template states
- Acceptance: in-panel template status reflects real Meta state

#### 3.5 Number quality and limit tracking
- Scope: poll and sync quality/limits; pause to low quality
- Acceptance: quality drop pauses the account and a super user can resume it

### M4. Upload, list handling, campaign draft, and summary

Status: Planned

#### 4.1 File upload and list storage
- Scope: upload CSV/Excel, store in Object Storage, read Google Sheet exports
- Acceptance: list records load correctly even with blank rows and invalid values

#### 4.2 Number cleaning and validation
- Scope: normalize numbers, remove duplicates, detect invalid contacts, store reasons
- Acceptance: invalid and duplicate counts match a hand-checked sample

#### 4.3 Campaign drafts and template mapping
- Scope: select template, map columns to variables, preview rendered content
- Acceptance: campaigns can be saved only when all required template variables are mapped

#### 4.4 Summary and dry-run rules
- Scope: apply rule checks and generate campaign summary before confirm
- Acceptance: summary shows blocked, invalid, and will-send counts correctly

#### 4.5 Campaign creation API contract
- Scope: backend endpoint to create campaigns from a common contract
- Acceptance: panel and API use the same campaign payload and result expectations

### M5. Sending, rules, and status processing

Status: Planned

#### 5.1 Confirm and queue messages
- Scope: run rules and queue valid messages as `queued` while blocked items remain blocked with a reason
- Acceptance: confirm creates the final queue without timing out on large inputs

#### 5.2 Running totals and campaign lifecycle
- Scope: update campaign totals from every message state change
- Acceptance: campaign totals match the per-number records

#### 5.3 Pause, resume, cancel, and schedule
- Scope: campaign controls and scheduler trigger
- Acceptance: scheduled or paused campaigns behave correctly and do not send extra messages

#### 5.4 Rules engine
- Scope: opt-out, repeat suppression, rate limits, quiet hours
- Acceptance: rules can be changed and take effect on the next campaign

#### 5.5 Opt-out processing
- Scope: record STOP messages per client and prevent future sends to opted-out numbers
- Acceptance: STOP for one client does not block another client

#### 5.6 Load check
- Scope: validate queueing and sending under large-volume conditions
- Acceptance: 200K-message runs do not duplicate or exceed the configured rate

### M6. Price lists, wallet, and refunds

Status: Planned

#### 6.1 Price list and charge policy
- Scope: client and global price config, decision switches by outcome
- Acceptance: price and charging rules are configurable without a code change

#### 6.2 Wallet ledger and balance safety
- Scope: append-only ledger, lock and validation of spend
- Acceptance: double confirm cannot overdraw the wallet

#### 6.3 Charge at confirm
- Scope: charge the wallet at campaign confirmation time and prevent underfunded sends
- Acceptance: short-balance campaigns are blocked before queueing

#### 6.4 Refund processing
- Scope: apply refund policy for failed Meta sends and deduplicate refunds
- Acceptance: failure processing creates one valid ledger refund per message

#### 6.5 Meta cost recording
- Scope: connect delivered message costs to a rate table and display them in the super-user view
- Acceptance: Meta cost is visible and tied to campaign/message results

#### 6.6 Ledger reconciliation
- Scope: nightly consistency check for wallet and campaign totals
- Acceptance: mismatch alert is raised if ledger and balance totals diverge

### M7. Reports, exports, and super-user Meta view

Status: Planned

#### 7.1 Daily stats table and scheduler refresh
- Scope: maintain date-based counts and charges for dashboard data
- Acceptance: charts are rebuilt from consistent daily stats

#### 7.2 Dashboard tiles and graph
- Scope: yesterday, last 15 days, month, and day-wise chart
- Acceptance: the dashboard matches the Dovesoft-style layout and numbers

#### 7.3 Month-wise campaign report
- Scope: summary report by month with CSV/Excel export
- Acceptance: CSV is valid and columns match the expected report structure

#### 7.4 Per-number campaign report
- Scope: full per-number output with the expected Dovesoft-style columns
- Acceptance: large exports are generated without memory failure

#### 7.5 Super-user Meta cost and margin view
- Scope: show Meta cost, billed amount, margin, quality, and limits by client/day
- Acceptance: client users cannot see Meta cost or margin

### M8. Pilot go-live and client migration

Status: Planned

#### 8.1 Alerts and operational readiness
- Scope: health, backup, stuck send, disk, callback warnings, and operations thresholds
- Acceptance: all critical alerts are triggered and visible to the super user

#### 8.2 Number move from Dovesoft
- Scope: runbook and migration of a real number into ReapLift
- Acceptance: a low-risk number can be moved without data loss or downtime

#### 8.3 Pilot client setup
- Scope: configure prices, wallet top-up, approvals, and templates for a live client
- Acceptance: client can access only its own dashboard and data

#### 8.4 First pilot campaign and comparison
- Scope: run one pilot campaign and compare results with Dovesoft baseline
- Acceptance: delivery and read metrics are acceptable and stable

#### 8.5 Go or no-go sign-off
- Scope: owner review and rollout decision
- Acceptance: owner approves the next client move or requests fixes before expansion

## Working rules

- Read this tracker before starting a session.
- Update the status when a task begins, is blocked, or is done.
- Do not mark a task complete without relevant validation and push.
- Keep milestone scope small enough that one developer can own it independently.
- If a task changes shape or risk, update both the tracker and the relevant spec in the same change set.

## Next implementation task

The active task is:

- M1.2 Migration 0002

The working spec is:

- [m1-0002-migration-spec.md](m1-0002-migration-spec.md)

The next step is to finish the migration design and schema validation, then move into 1.3 and 1.4 without mixing unrelated exploration into the same branch.

## Subtask template for each task

Each task should follow this pattern:

1. Goal
2. Inputs
3. Outputs
4. Components involved
5. Subtasks
6. Acceptance criteria
7. Risks and blockers
8. Dependency on previous milestones

## Example task format

This is the working company-style pattern used for implementation:

### Login page feature

#### Goal
Create a login and sign-up flow that allows a user to access the dashboard.

#### 1.1 UI tasks
- 1.1.1 Build login and sign-up screens in React
- 1.1.2 Add client-side validation for valid email and password input
- 1.1.3 Add loading state and API call progress spinner
- 1.1.4 Persist the session securely and route to dashboard on success

#### 1.2 Backend tasks
- 1.2.1 Receive login request and validate payload
- 1.2.2 Check user record in database and verify credentials
- 1.2.3 Create secure session and return auth response
- 1.2.4 Reject invalid credentials with the correct API error

#### Acceptance criteria
- successful login and sign-up both work
- invalid input is rejected in UI and server checks
- session persists securely across pages
- dashboard loads only after successful authentication

## Working rules

- Read this tracker before starting a session.
- Update the status when a task begins, is blocked, or is done.
- Do not mark a task complete without relevant validation and push.
- Keep milestone scope small enough that one developer can own it independently.
- If a task changes shape or risk, update both the tracker and the relevant spec in the same change set.

## Next implementation task

The active task is:

- M1.2 Migration 0002

The working spec is:

- [m1-0002-migration-spec.md](m1-0002-migration-spec.md)

The next step is to finish the migration design and schema validation, then move into 1.3 and 1.4 without mixing unrelated exploration into the same branch.
