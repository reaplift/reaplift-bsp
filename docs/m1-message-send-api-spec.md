# M1.3 / M1.4 / M1.5 API contract spec

This document defines the first real implementation contracts for the messaging flow. The goal is to remove ambiguity before coding the server modules, database logic, and worker behavior.

## Scope

These contracts cover the first end-to-end WhatsApp send flow:

1. create a WhatsApp account for a client
2. create or fetch a template
3. send a message through the worker and Meta API
4. process webhook status updates
5. support a mock provider path while the real Meta account is not yet available

This is the spec the server implementation must satisfy.

## Provider mode contract

The system supports two provider modes for message delivery:

- `live`: calls the real Meta Graph API and real webhook callbacks
- `mock`: simulates the same send and event flow for local testing, QA, and milestone validation before production Meta access is available

### Mock provider behavior

The mock provider must return the same contract shape as the live provider so the queue worker and status processor are not different by mode.

Example mock outcomes:

```json
{
  "status": "sent",
  "metaMessageId": "mock-msg-1001",
  "outcome": "success"
}
```

```json
{
  "status": "failed",
  "metaMessageId": "mock-msg-1002",
  "errorCode": "RATE_LIMITED",
  "outcome": "failure"
}
```

```json
{
  "status": "blocked",
  "metaMessageId": "mock-msg-1003",
  "reason": "INVALID_RECIPIENT",
  "outcome": "blocked"
}
```

This mock mode must allow a campaign to generate realistic distributions such as:
- 99.999% success
- 0.00001% failure
- 0.002% blocked

These values are only for deterministic testing and not for product policy; the real Meta provider remains the source of truth in production.

### Contract requirement

The worker implementation must treat `live` and `mock` as interchangeable from the application perspective. The same request contracts, status transitions, and queue semantics must work in both modes.

---

## 1. Create WhatsApp account

### Endpoint

POST /api/v1/clients/:clientId/wa-accounts

### Purpose
Create a WhatsApp account record for a client, linked to a Meta WhatsApp Business Account and the client phone number.

### Auth
- Requires authenticated user
- Only staff or client owner with write access for that client may call it
- Client-scoped record must be enforced in every query

### Request schema

```json
{
  "wabaId": "123456789012345",
  "phoneNumberId": "987654321098765",
  "displayPhone": "919812345678",
  "displayName": "ReapLift Ops",
  "metaPayer": "reaplift_card",
  "sendRatePerSec": 20
}
```

### Validation rules
- `wabaId`: required, non-empty string
- `phoneNumberId`: required, non-empty string
- `displayPhone`: required, digits only, country code included, no + sign, e.g. `919812345678`
- `displayName`: optional string, max 120 chars
- `metaPayer`: required enum: `reaplift_card | partner_credit_line | reaplift_credit_line`
- `sendRatePerSec`: optional integer, default `20`, min `1`, max `100`
- `clientId` comes from route, not body

### Success response

Status: 201 Created

```json
{
  "id": "uuid",
  "clientId": "uuid",
  "wabaId": "123456789012345",
  "phoneNumberId": "987654321098765",
  "displayPhone": "919812345678",
  "displayName": "ReapLift Ops",
  "metaPayer": "reaplift_card",
  "status": "active",
  "sendRatePerSec": 20,
  "createdAt": "2026-10-18T12:00:00.000Z"
}
```

### Error responses

- 400 INVALID_REQUEST: validation error
- 401 UNAUTHORIZED: not logged in
- 403 FORBIDDEN: not allowed for this client
- 409 DUPLICATE_PHONE_NUMBER: same phone number already exists for this client or globally for the business
- 500 INTERNAL_ERROR: unexpected failure

### DB effects
- insert into `wa_accounts`
- `client_id` set from authenticated client context
- `status` default `active`
- store encrypted token only when the system is configured to fetch and store Meta token in a later step

### Test cases
- creates a valid record
- rejects invalid phone number format
- rejects unauthorized client access
- rejects duplicate phone number id
- creates row with correct `client_id`
- returns sanitized public fields only

---

## 2. List WhatsApp accounts

### Endpoint

GET /api/v1/clients/:clientId/wa-accounts

### Purpose
Return the client's WhatsApp account list.

### Auth
- same as above

### Success response

```json
{
  "items": [
    {
      "id": "uuid",
      "wabaId": "123456789012345",
      "phoneNumberId": "987654321098765",
      "displayPhone": "919812345678",
      "status": "active",
      "metaPayer": "reaplift_card",
      "sendRatePerSec": 20
    }
  ]
}
```

### Error responses
- 401, 403, 500 as above

### Test cases
- returns only records for the current client
- excludes records from other clients
- supports empty state

---

## 3. Create or sync template

### Endpoint

POST /api/v1/clients/:clientId/templates

### Purpose
Create or sync a template record for a WhatsApp account.

### Auth
- same as above

### Request schema

```json
{
  "waAccountId": "uuid",
  "name": "welcome_message",
  "language": "en",
  "category": "MARKETING",
  "components": [
    { "type": "BODY", "text": "Hello {{1}}" }
  ],
  "variableCount": 1
}
```

### Validation rules
- `waAccountId`: required valid UUID, belongs to same client
- `name`: required, 1-80 chars, slug-like naming allowed
- `language`: required string, example `en`, `hi`, `en_IN`
- `category`: required enum `MARKETING | UTILITY | AUTHENTICATION`
- `components`: required array, must be valid template component payload
- `variableCount`: required integer >= 0 and matches actual placeholders in content
- `name` + `waAccountId` + `language` is unique

### Success response

```json
{
  "id": "uuid",
  "clientId": "uuid",
  "waAccountId": "uuid",
  "name": "welcome_message",
  "language": "en",
  "category": "MARKETING",
  "status": "PENDING",
  "variableCount": 1,
  "updatedAt": "2026-10-18T12:00:00.000Z"
}
```

### Error responses
- 400 INVALID_REQUEST
- 401 UNAUTHORIZED
- 403 FORBIDDEN
- 404 WA_ACCOUNT_NOT_FOUND
- 409 TEMPLATE_NAME_CONFLICT
- 500 INTERNAL_ERROR

### DB effects
- insert/update `templates`
- set `status` to `PENDING` until Meta approval is synced
- ensure `client_id` is set from route context and `wa_account_id` belongs to same client

### Test cases
- valid create succeeds
- template for wrong client rejected
- duplicate template name in same account rejected
- invalid component schema rejected

---

## 4. Send message

### Endpoint

POST /api/v1/messages/send

### Purpose
Queue a message send for an approved template and valid recipient.

### Auth
- requires authenticated user or service caller with client scope
- client must have permission for the target WhatsApp account and template

### Request schema

```json
{
  "clientId": "uuid",
  "waAccountId": "uuid",
  "templateId": "uuid",
  "toNumber": "919812345678",
  "variables": ["Amit", "2026-10-18"],
  "source": "panel",
  "campaignId": "uuid"
}
```

### Validation rules
- `clientId`: required valid UUID
- `waAccountId`: required valid UUID, belongs to same client
- `templateId`: required valid UUID, belongs to same client and same waAccountId
- `toNumber`: required digits only, country code required, no plus sign
- `variables`: array of strings, length matches template variable count
- `source`: enum `panel | api | crm | cli`
- `campaignId`: optional UUID
- the template status must be `APPROVED`
- the wa account status must be `active`
- no send if client wallet is insufficient where wallet checks are enabled

### Success response

Status: 202 Accepted

```json
{
  "messageId": 12345,
  "status": "queued",
  "queuedAt": "2026-10-18T12:00:00.000Z",
  "clientId": "uuid",
  "waAccountId": "uuid",
  "templateId": "uuid"
}
```

### Error responses
- 400 INVALID_REQUEST
- 401 UNAUTHORIZED
- 403 FORBIDDEN
- 404 TEMPLATE_NOT_FOUND
- 404 WA_ACCOUNT_NOT_FOUND
- 422 ACCOUNT_PAUSED
- 422 TEMPLATE_NOT_APPROVED
- 422 INVALID_RECIPIENT
- 429 RATE_LIMITED
- 500 INTERNAL_ERROR

### DB effects
- create row in `messages` with `status = 'queued'`
- `client_id`, `wa_account_id`, `template_id` set from validated entities
- `variables` stored as JSON array
- `queued_at = now()`
- `attempts = 0`
- `next_attempt_at = now()`

### Worker behavior
- worker claims up to a limited batch using `FOR UPDATE SKIP LOCKED`
- marks row as `sending`, increments attempts
- applies per-account send rate limiter
- calls Meta Graph API with template content and recipient number
- writes `meta_message_id` if returned by Meta
- updates row to `sent` or `failed`

### Test cases
- valid payload queues a message
- invalid toNumber rejected
- template not approved rejected
- account paused rejected
- worker marks row `sending` then `sent` on success
- worker marks `failed` on Meta error
- duplicates are prevented by idempotency rules if same request is retried

---

## 5. Webhook status update

### Endpoint

POST /api/v1/webhooks/meta

### Purpose
Receive and process Meta delivery and status callbacks.

### Auth
- webhook signature verification required
- request body is raw payload from Meta

### Request contract

Meta sends a JSON payload including `entry`, `changes`, and message metadata. The server must verify the callback signature before processing.

### Validation rules
- verify signature using configured app secret and request headers
- reject invalid or unsigned requests immediately
- store raw payload in `meta_events` table
- process event idempotently based on message metadata and event timestamp
- ignore unsupported event types without marking as failed

### Success response

Status: 200 OK

```json
{
  "status": "accepted"
}
```

### Error responses
- 400 INVALID_PAYLOAD
- 401 UNAUTHORIZED_WEBHOOK
- 500 INTERNAL_ERROR

### DB effects
- insert raw payload into `meta_events`
- parse and update `messages` status according to Meta event data
- create `message_status_events` rows only when a new state is acceptable and not duplicated
- update delivered/read/failed timestamps accordingly

### State transition rules
- `queued -> sending -> sent -> delivered -> read`
- `failed` is terminal for the given retry window but may be retried based on policy
- repeated webhook state events must not reapply the same transition twice
- if a later status is older than the current status, ignore it

### Test cases
- valid webhook updates message to `delivered`
- duplicate webhook does not double-count
- invalid signature rejected
- unknown event type ignored safely
- out-of-order meta timestamp ignored

---

## 6. Shared implementation rules

The following rules are mandatory across all endpoints and jobs:

1. Every table and query must be client-scoped by `client_id`
2. Every business mutation must validate that the row belongs to the authenticated client
3. Money values are stored as whole paise in `bigint`
4. Phone numbers are stored as digits with country code and no plus sign
5. External API calls must be retried only for transient failures
6. No write may be made without a validation gate
7. All operations must be idempotent at the business level where repeated requests are possible
8. All incoming API data must be validated with Zod or equivalent before use

---

## 7. Acceptance criteria for M1 contract

The M1 implementation is complete only when all of the following are true:

- create account API works and stores client-scoped wa_accounts
- template creation works and rejects invalid client or account ownership
- send message API creates a queued message with correct validation
- worker consumes queued messages and calls Meta API correctly
- webhook processor updates messages and ignores duplicate/out-of-order events
- all contracts are proven by automated tests
- one real end-to-end send path can be demonstrated end to end

This is the engineering contract the team should code against.
