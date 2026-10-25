# Project tracker

This tracker is organized like a company execution plan:

- Milestone: a business outcome
- Task: a major delivery unit
- Subtask: a unit of work that can be assigned independently
- Acceptance criteria: definition of done for that unit
- Design note: future context or architectural guidance that is not active scope

This file is the source of truth for what is active, what is blocked, and what is next. It is not a local-machine notes file.

### Detail stays nested, not scattered

The tracker is intentionally detailed, but the detail must remain under the correct milestone. A future table, page, task, or API can appear in the tracker for context, but it is not active work until its milestone is open.

This keeps the plan readable and prevents drift:

- current milestone = the client-visible flow being built now
- task = the major workstream inside that flow
- subtask = the implementation details for that task
- future milestone = not active, not in flight, and not mixed into current execution

Example: a wallet table or report table can be listed as a future milestone item for M6 or M7, but it should not be opened as active work while we are still building M2 access and admin control.

## Platform design note

This tracker is intentionally WhatsApp-first because that is the current BSP delivery goal, but the platform architecture should remain generic enough to support other messaging channels and provider integrations later without rewriting the core client, wallet, campaign, or admin flows. The current scope is WhatsApp and Meta; later channel expansion belongs in a separate milestone layer, not in the base product design.

## Flow-based milestone model

The tracker is organized around client-visible delivery milestones, not around isolated backend files. Every milestone must map to a real product flow that can be shown to a client or stakeholder and validated page by page.

Example execution model:

- Flow milestone 1: Login and access
  - Page: Login
  - Validation: user can sign in and sees only their permitted client view
- Flow milestone 2: Dashboard
  - Page: Dashboard
  - Validation: client sees current totals, recent activity, and delivery health
- Flow milestone 3: WhatsApp account and template setup
  - Pages: Settings / Templates / Account management
  - Validation: client can bind a WhatsApp account and template to their business
- Flow milestone 4: Campaign creation and send
  - Page: Push Campaign
  - Validation: user can create a campaign, confirm it, and trigger queueing
- Flow milestone 5: Message delivery and status
  - Page: Dashboard / campaign detail / logs
  - Validation: sent, delivered, read, failed and retry states are visible and correct
- Flow milestone 6: Admin and access control
  - Page: Admin
  - Validation: staff and client roles are enforced correctly
- Flow milestone 7: Wallet, reports, and operational visibility
  - Pages: Dashboard / Reports / Admin
  - Validation: spend, refund, and summary data are trusted by the client

This means each milestone should end with a product demo, not only a backend implementation. The UI pages are not separate execution threads; they are the proof points for the underlying business slices.

### Principle for active scope

We keep the tracker rich and specific, but only the active milestone should be treated as in-flight execution. Every item below that milestone is either:

- part of the current flow and being built now,
- a dependency that must exist before this milestone is valid, or
- a future milestone note kept for planning only.

This is the rule that prevents us from creating tables or features for M4, M5, M6, or M7 while still in M2. The plan is detailed, but it is still intentionally narrowed to the current business flow.

The same rule should be applied to every milestone in the tracker:

- each milestone should list only the tasks that belong to that flow
- every task should be clearly tied to the milestone's business outcome
- future milestones remain planning references, not active execution items
- once a milestone is active, only its subtask tree is in motion

## Do / Do not / Hard checks

### Do
- Keep one task to one real end-to-end flow.
- Include the business outcome, UI slice, backend behavior, and validation in the task definition.
- Verify the flow with real request/response evidence before calling it complete.
- Treat the tracker as the source of truth, and update it when the implementation actually changes.
- Keep the working scope narrow and current; move future work to a later milestone.

### Do not
- Do not call a task done because a page renders or a component exists.
- Do not call a task done because state changed locally in React.
- Do not call a task done because a mock route exists in memory.
- Do not mix future milestone work into the active milestone.
- Do not rely on app behavior that accepts any input without validation.
- Do not claim success without checking the real network, server logs, and test evidence.

### Hard checks before marking a task complete
- Can a user execute the flow with the real UI and see the expected outcome?
- Does the frontend call the backend route and receive a real response code?
- Does the backend validate input and reject invalid requests?
- Does the app persist or update the correct state, not just local component state?
- Are role and tenant restrictions actually enforced?
- Does the tracker status match the real implementation, not the intended one?

If any hard check fails, the task stays in progress, prototype, or blocked. It is not complete.

## Standard milestone template

Every milestone in this tracker must follow the same format so the delivery plan is reviewable by both engineering and client stakeholders.

### Definition of a finished task

A task is not considered complete just because code exists. A task is only finished when all of the following are true:

- the business flow is clearly named and scoped
- the UI flow exists and can be exercised by a user
- the backend route or service supports the same flow
- role and tenant validation are enforced
- validation or acceptance checks are written and passing
- the flow can be demonstrated without hidden mock state or fake logic
- the milestone evidence pack exists and is attached to the task

If any of the above is missing, the task remains prototype or in progress, not done.

This matters because the tracker should prevent false confidence. A page that changes React state locally is not the same as a working user flow. A route that exists in memory is not the same as a real persisted system. A login flow that accepts any input is not a working login.

### Milestone evidence pack requirement

Every milestone must include a dedicated evidence folder and documents:

- README.md for scope and flow summary
- test-evidence.md for commands and proof output
- frontend.md for page-level actions and validation
- backend-api.md for routes and payload checks
- database.md for the data assumptions and schema notes for the milestone
- e2e.md for the end-to-end path from page to server to data response

The evidence pack is part of the milestone completion standard; it is not optional.

### Template

#### Business outcome
What customer problem or operational outcome this milestone solves. Keep this brief and client-facing.

#### User flow
The exact user journey being delivered. State who starts it, what they click, and what result they expect.

#### Frontend milestone
The page or UI slice that exposes this flow. Describe the visible screens and the state they must show.

#### Backend milestone
The API, DB, security, and integration work that makes the flow real. This is where rent/tenant rules and data writes live.

#### Roles allowed
The role or roles that can perform the flow and what each can and cannot do. Keep it explicit and role-based.

#### Tenant and access rules
The client isolation and permission rules that must be enforced. This is where cross-client blocking is recorded.

#### End state
The final state after the milestone is complete and how a stakeholder can validate it. This should read like a demo outcome.

#### Acceptance criteria
The business and technical checks that prove the flow works. Include happy path and blocked path.

#### Dependencies and blockers
Any external services, approval gates, or upgrade requirements. Capture what is needed to complete the milestone.

#### Owner
Primary owner and any supporting roles. This makes accountability visible.

## Immediate milestone set

The next milestone set is intentionally narrowed to the flow that gives the client a usable platform and a safe operating model.

### M2.0 Access and tenant isolation
- Business outcome: a user can only access the correct platform view for their role and client.
- Frontend milestone: login page and role-based landing screen.
- Backend milestone: user sessions, auth checks, roles, client scoping, and cross-client rejection.
- Roles: super admin; client admin; later: client staff, auditor, Meta admin.
- End state: a logged-in user sees only the pages and data permitted for their role and tenant.
- Acceptance: wrong role cannot open admin, client A cannot see client B data, access rules are enforced in backend queries.

### M2.1 Admin control plane
- Business outcome: the platform owner can onboard and manage clients safely.
- Frontend milestone: admin dashboard with client create/edit, role assignment, and staff mapping.
- Backend milestone: client creation, role assignment, staff-client mapping, audit log insertion, and client activation.
- Roles: super admin; client admin for their own tenant later.
- End state: a valid client is active, assigned to the correct admin, and visible only within its tenant scope.
- Acceptance: client registration is auditable, access is role-based, and invalid assignments are rejected.

### M2.2 Meta account and number linkage
- Business outcome: the approved client is connected to a valid Meta account and WhatsApp number.
- Frontend milestone: account connection and number status screen.
- Backend milestone: Meta account config, number validation, status sync, and pause / resume controls.
- Roles: super admin first; client admin later after approval.
- End state: the client has only valid, approved Meta account and phone-number metadata attached to the tenant.
- Acceptance: invalid number or account state is blocked, and both the client and admin are notified on account problems.

### M3.0 Template approval and compliance
- Business outcome: a client can prepare a template, but only an approved template can be used for send.
- Frontend milestone: template draft, submit, and approval UI for client and admin.
- Backend milestone: template state machine, admin approval flow, rejected or paused state handling, approved-only send enforcement.
- Roles: client admin submits; super admin approves or rejects.
- End state: only approved templates are eligible for live campaigns; rejected or paused templates are blocked.
- Acceptance: unapproved template cannot be selected for send; admin can approve or reject; audit entry is created for each action.

### M5.0 Campaign send flow
- Business outcome: the approved client can create, confirm, and track a campaign from draft to completion.
- Frontend milestone: dashboard + campaign create / confirm screens.
- Backend milestone: campaign validation, queueing, send execution, status transitions, webhook processing, and campaign result updates.
- Roles: client admin; super admin for operational oversight.
- End state: the campaign is queued, sent, and tracked to final delivery or failure states with clear client visibility.
- Acceptance: send works from validation to queue to final status, and failed or delayed sends are visible and notified.

### M6.0 Wallet, spend, and refund controls
- Business outcome: campaign spend is safe, auditable, and visible to the right parties.
- Frontend milestone: wallet summary, low-balance alerts, charge and refund panel.
- Backend milestone: wallet ledger, charge / refund logic, out-of-budget checks, alerts, and audit logs.
- Roles: super admin and client admin for their own tenant.
- End state: spend stays within valid limits and every charge or refund is tied to a real event and visible to the right client/admin parties.
- Acceptance: low-balance campaigns are blocked, charges/refunds are immutable ledger entries, and audit history is preserved.

### M7.0 Notification and alerting
- Business outcome: clients and admins are informed about important lifecycle events without relying on the UI alone.
- Frontend milestone: notification center or alert panel.
- Backend milestone: state-change triggers, email notifications, retries, admin alerts, and audit logging.
- Roles: client admin and super admin depending on event type.
- End state: critical events trigger email notification to the right audience and the event is logged.
- Acceptance: new client, template approval, out-of-budget, send completion, and account issue events produce notification records and deliver email to the right recipients.

These milestones are intentionally ordered to make the product demoable in slices. Each one can be shown to a client as a real working flow, even when the later systems are still being built.

### Future use cases

The current design should not be treated as a WhatsApp-only dead end. Future work such as other messaging providers, Airtel integrations, chatbot flows, or additional channel-specific services can be introduced later as additional provider adapters and channel-specific modules, without changing the client, campaign, wallet, and admin core contracts. This is a P2/P3 expansion track and is not the current delivery scope.

## Front-end scope and product flow map

The tracker is organized around product delivery milestones, not around every screen in the React app. The UI pages are the surfaces that expose those milestones; they are part of the same business flow, but they are not separate milestones by themselves unless a page has a unique backend contract or independence requirement.

### Page map in the current React app

- Login: authentication entry point for staff and client users
- Dashboard: summary view for delivery health, counts, wallet and recent activity
- Push Campaign: campaign create / confirm / send flow
- Admin: client, staff and access management for M2

These pages are not independent delivery tracks. They are the UI for the product journey below.

### Access control and client isolation model

This is a mandatory part of the tracker and cannot be treated as a side note.

#### 1. Page-level access
- The UI must hide or disable pages based on role and permission.
- Example: a normal client user should not see Admin actions or staff-only pages.
- Example: a staff user should only see the clients assigned to them.
- Example: super admin sees the full admin plane; a client user sees only their own dashboard and client objects.
- The frontend should only be a convenience layer. It must never be the final authority.

#### 2. Backend authorization
- Every protected API call must verify the authenticated user and their role.
- Every request must resolve the allowed client context before executing a query.
- If the user is a client account, the backend enforces their client_id scope.
- If the user is staff, the backend checks staff-client assignments or the super-admin flag.

#### 3. Client isolation in data access
- Every table in the system must carry `client_id` and every query must include a `WHERE client_id = ?` filter.
- No dashboard, report, message, template, or wallet query is allowed to ignore the tenant scope.
- The backend must reject requests that try to access another client's record even if the route or page is visible.
- The same rule applies to list endpoints, detail endpoints, wallet queries, webhook updates, and admin actions.

#### 4. What this means for the admin portal
- A user can only reach the admin portal if they have an admin role or explicit permission.
- A client cannot see another client's admin or data even if they know the route or ID.
- A staff user sees only the clients assigned to them.
- Super admin sees platform-wide admin views, but still only with backend scoping applied.

This is not optional. If the UI hides a route but the API does not enforce it, the system is still unsafe.

### Full business flow that the tracker is tracking

1. User logs in
2. User opens the dashboard and sees client-scoped metrics
3. User creates or edits a campaign and chooses a template/account
4. Message is validated and queued in the API / DB
5. Worker claims the message and sends it through Meta or the mock provider
6. Meta webhook reports delivery / read / failed status back to the receiver
7. Event processor updates message state and any wallet or refund logic
8. Dashboard/Reports show the final result for that client

This is the real end-to-end flow that connects M1, M2 and later milestones. The tracker should be read as: backend milestones build the flow, and the front-end pages expose and consume that flow. The UI exists to make each backend milestone usable; it is not a separate independent milestone stack.

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

#### 1.2 DB creation for messaging platform
- Status: Done
- Owner: backend
- Spec: [m1-0002-migration-spec.md](m1-0002-migration-spec.md)
- DB file: `0002_message_platform.sql`
- Scope:
  - 1.2.1 design the schema for clients, wa_accounts, templates, messages
  - 1.2.2 add the database tables for the messaging platform
  - 1.2.3 validate the DB setup locally and add schema tests
- Acceptance:
  - additive schema only
  - all tables include client_id and filtering rules
  - DB setup applies cleanly with `pnpm migrate`
  - test proves the table and column structure is correct
  - verified by the integration test and successful local Postgres run

#### 1.3 Encryption and seed account setup
- Status: Planned
- Owner: backend/security
- Scope: encrypt Meta keys, seed the first account, and validate account records
- Acceptance: account data can be stored safely and loaded by the server

#### 1.4 Meta client and error classifier
- Status: Done
- Owner: backend
- Scope: Meta wrapper, request shaping, safe failure handling
- Acceptance: backend can call Meta endpoints and classify errors correctly

#### 1.5 Sender worker
- Status: Done
- Owner: worker
- Scope: queue polling, send logic, retry policy, row locking
- Acceptance: a queued message is delivered to Meta and marked sent

#### 1.6 Receiver and webhook endpoint
- Status: Done
- Owner: backend
- Scope: Meta status handler, webhook verification, raw event processing
- Acceptance: event updates are stored and message status moves forward

#### 1.7 Event processor and ledger updates
- Status: Done
- Owner: backend
- Scope: mark delivered/read/failed, charge or refund wallet state
- Acceptance: state transitions are consistent and idempotent

#### 1.8 End-to-end send test
- Status: Planned
- Owner: QA + backend
- Scope: test the real send path from DB to Meta callback to campaign result
- Acceptance: one fully validated send path passes end-to-end

### M2. Logins, roles, clients, and access scope

Status: In progress

This milestone owns the access-control and operational foundation of the BSP. Any table, screen, or API that is not required to complete login, role enforcement, staff/client access, or tenant isolation remains outside active execution until the relevant milestone is opened.

#### M2 Admin control plane (explicit client flow)

This is a major operational flow and should be treated as a separate milestone even though it sits inside M2. It is not a minor setting screen.

##### M2 task structure

- Task 2.1: user auth and session model
- Task 2.2: request scope and authorization enforcement
- Task 2.3: client and staff admin operations
- Task 2.4: role-based panel shell and menu visibility
- Task 2.5: client onboarding and activation
- Task 2.6: Meta account and wallet linkage for admin
- Task 2.7: admin audit and operational tracking

Each of these tasks stays scoped to the M2 flow. Anything related to campaign creation, list handling, reporting, or wallet automation later in M4-M7 is kept as a future milestone reference, not active M2 scope.

The admin flow covers the full operations layer for the platform:

- register a new client and set their account status
- create staff users and assign client access
- connect a client to a Meta business account and WhatsApp number
- attach templates and business settings to that client
- fund or manage wallet balance and top-ups
- review campaign spend, refunds, and failed message reasons
- audit admin actions and investigate operational issues

This flow is business-critical because the platform cannot operate without a trusted admin layer. It is also the layer that gives the client and staff the runtime environment they need to actually use the product.

#### 2.1 Users and sessions
- Status: In progress
- Scope: create users, password hashing, session creation, secure cookie behavior
- Current reality: auth and role gating are implemented in the shared layer and login flow; session persistence and revocation remain follow-on work for the full M2 auth slice.
- Acceptance: valid login works; invalid login fails; session can be revoked

#### 2.2 Request scope and authorization
- Status: In progress
- Scope: every request gets role and client context; enforce client isolation and staff access rules
- Current reality: shared access helpers and page visibility are in place; backend route enforcement is still being hardened as the active admin flow matures.
- Acceptance: client A cannot read or modify client B data

#### 2.3 Client and staff admin flows
- Status: In progress
- Scope: add and manage clients, users, staff-client assignments, audit logs
- Current reality: active work is focused on client creation, activation/suspension, and staff assignment in the admin panel and matching server API routes.
- Acceptance: super user can create and manage the entity graph

#### 2.4 Panel shell and menu by role
- Status: In progress
- Scope: login page, dashboard shell, sidebar, role-based menu
- Current reality: login and role-aware page access are implemented; navigation is in the active admin flow, but the full shell is not yet treated as a separate milestone expansion.
- Acceptance: different roles see only their allowed screens

#### 2.5 Admin onboarding and client activation
- Status: In progress (prototype)
- Scope: register client, assign initial staff, verify business metadata, activate or suspend client
- Current reality: this is the current live implementation slice, but it is not complete. The flow is being built as a demo/prototype: UI state changes, in-memory API routes, and shared role logic exist, but real auth, persistence, and end-to-end validation are still missing.
- Acceptance: a newly created client can be activated with the correct role access and constraints once the full login + session + backend validation path is complete

### Current active execution note

The active milestone is M2.1 / 2.5 admin onboarding and client activation. The current implementation scope is intentionally narrow and limited to a prototype slice:

- admin creates a client in the UI
- admin sees the client list in local React state
- admin toggles active/suspended state in local React state
- admin reassigns the client owner / staff in local React state
- role gating prevents non-admin access in the shared access model

This is the only in-flight flow, but it is not complete. It is a prototype in current work, not a finished milestone. Future milestone items such as wallet ledger, reports, Meta account linkage, and message send flows remain planned and are not active work until this slice is complete.

#### Current active UI slice
- Page: Admin panel
- User flow: super admin opens admin, creates a client, reviews the list, toggles activation, and reassigns staff.
- UI states:
  - client list visible
  - add-client form visible when triggered
  - status badges showing active / suspended
  - staff change action next to assigned staff
  - role-based hiding of admin controls for non-admin roles
- Frontend behavior: the current slice is local state driven and not yet connected to real auth or persisted backend data.
- Validation gap: login and admin actions still accept local mock state and do not prove a real validated session.

#### Current active backend technical details
- Route scope: admin-only client management endpoints only
- API surface in current slice:
  - `GET /api/admin/clients`
  - `POST /api/admin/clients`
  - `PATCH /api/admin/clients/:id/status`
  - `PATCH /api/admin/clients/:id/staff`
- Data contract: shared AdminClient schema in the shared package defines id, name, contactEmail, assignedStaff, status, walletBalance.
- Validation: payloads are checked with Zod before create/update operations; invalid or missing values are rejected with 400 responses.
- Auth model: role checks are enforced in the shared access logic, but login itself is still not backed by a real backend auth flow or persisted user session.
- Persistence model: current implementation is in-memory for the active flow and is intentionally minimal; it does not yet represent the final production contract.
- Tenant rule: this slice stays scoped to the admin flow and does not expand into unrelated tables or cross-client data access logic until the client management milestone is complete.

#### Current milestone status summary
- Frontend status: prototype/in progress; UI flow exists for create/list/status/staff change but is not yet authenticated or persisted
- Backend status: prototype/in progress; admin route support exists for list, create, status update, and staff update, but it is in-memory and not final persistence
- Verification status: build, web typecheck, and focused onboarding tests pass for the prototype slice, but they do not yet prove a real end-to-end authenticated flow
- Completion status: not complete; task remains in progress until real login, session, backend validation, and persistence exist
- Scope lock: no future milestone work is opened while this flow remains active
#### 2.6 Meta account and wallet linkage for admin
- Status: Planned
- Scope: admin links client to Meta account, checks phone numbers, configures paying account, and links wallet state to the client
- Acceptance: a client can only operate on approved Meta numbers and a valid wallet state

#### 2.7 Admin audit and operational tracking
- Status: Planned
- Scope: view all staff actions, wallet events, client changes, Meta account changes, and message exceptions
- Acceptance: a super user can reconstruct the timeline of what happened and who changed it

### M3. Connected number, templates, and Meta sync

Status: Planned

This milestone is specifically about Meta account linkage and template readiness. It does not include campaign creation, wallet charging, or reporting. Those belong to M4-M7 and remain future scope until M3 is complete.

##### M3 task structure

- Task 3.1: Meta number linkage and business account validation
- Task 3.2: token exchange and onboarding flow for connected accounts
- Task 3.3: template authoring and submission workflow
- Task 3.4: template sync and state visibility
- Task 3.5: number quality and limit monitoring

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

This milestone handles the campaign pre-flight layer: upload, list hygiene, mapping, and dry-run summary. It does not include the actual queueing or sending step; that belongs to M5.

##### M4 task structure

- Task 4.1: list upload and storage
- Task 4.2: contact cleanup and validation
- Task 4.3: campaign draft and template mapping
- Task 4.4: summary and dry-run checks
- Task 4.5: campaign creation API contract

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

This milestone owns the execution layer: confirm, queue, send, rules, and status transitions. It remains strictly separate from M6 wallet accounting and M7 reporting; those are downstream concerns, not active scope for this milestone.

##### M5 task structure

- Task 5.1: confirm and queue valid messages
- Task 5.2: campaign lifecycle totals and state tracking
- Task 5.3: pause, resume, cancel, and scheduling rules
- Task 5.4: rules engine and suppression controls
- Task 5.5: opt-out processing and data isolation
- Task 5.6: load and scale validation

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

This milestone covers the financial correctness layer around campaign execution. It is not a separate delivery stream from M5; it is the billing and safeguarding layer that validates the send flow after the campaign is confirmed and queued.

##### M6 task structure

- Task 6.1: price list and charge policy
- Task 6.2: wallet ledger and balance safety
- Task 6.3: charge at confirm
- Task 6.4: refund processing and deduplication
- Task 6.5: Meta cost recording and visibility
- Task 6.6: ledger reconciliation checks

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

This milestone is the reporting and operational visibility layer. It depends on M5 and M6 data being valid, and it does not reopen earlier delivery decisions. Its scope is limited to reporting, exports, and super-user operational visibility.

##### M7 task structure

- Task 7.1: daily stats and scheduler refresh
- Task 7.2: dashboard tiles and graphing
- Task 7.3: month-wise report exports
- Task 7.4: per-number campaign report generation
- Task 7.5: super-user Meta cost and margin view

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

This is the launch milestone. It is not a new product design layer; it is the rollout and validation stage that proves M1-M7 are ready for a live client, with migration and go/no-go gates.

##### M8 task structure

- Task 8.1: alerts and operational readiness
- Task 8.2: number migration from Dovesoft
- Task 8.3: pilot client setup
- Task 8.4: first pilot campaign and comparison
- Task 8.5: go or no-go sign-off

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
