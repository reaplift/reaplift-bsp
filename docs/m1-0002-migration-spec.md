# M1.2 migration 0002 specification

## Milestone

M1. First real WhatsApp send flow

## Goal

Create the base schema needed to track a client, its WhatsApp account, templates, queued messages, and delivery updates.

This is the platform foundation for later work in milestone 1.

## Scope

### In scope
- add the 0002 migration file
- define the core tables for client, account, template, and message flow
- keep the migration additive only
- validate the migration locally with the repo migration runner
- add schema-level validation tests

### Out of scope
- Meta sending logic
- webhook handling logic
- worker implementation
- UI screens
- wallet charging logic

## Task breakdown

### 1.2.1 Schema design
- define the required tables and their columns
- enforce client-scoped data patterns
- ensure status fields and IDs are explicit and queryable
- use money values as whole paise bigint
- store numbers as digits with country code and no plus sign

### 1.2.2 Migration file creation
- create a new numbered migration file for 0002 only
- do not edit earlier merged migration files
- keep the migration incremental and backwards-compatible

### 1.2.3 Local validation
- run `pnpm migrate`
- validate the schema can be applied cleanly on a local DB
- verify the new tables and columns exist as expected

### 1.2.4 Test coverage
- add schema tests to confirm the migration result
- confirm each table includes the required fields and relationships
- verify client_id filtering assumptions are documented and enforced

## Functional requirements

- every table includes `client_id`
- every query for business data is client-scoped
- money is stored as `bigint` in paise
- phone numbers use digits with country code, no plus sign
- status values are explicit and observable for downstream processing
- the migration must not break the existing `0001_init.sql` state

## Acceptance criteria

The task is done only when all of the following are true:

1. A new migration 0002 file exists with the correct numbering and naming convention.
2. The schema supports the first WhatsApp message lifecycle: client, account, template, and message tracking.
3. Every major table carries `client_id` and supports client isolation.
4. The migration runs successfully with the repo migration command.
5. Tests confirm the expected schema and fields exist.
6. The tracker is updated to show the task status correctly.
7. No unrelated application code changes are mixed into this task.

## Dependencies

This migration is the required foundation for:

- M1.3 encryption + seed account
- M1.4 Meta client and error classifier
- M1.5 sender worker
- M1.6 receiver and webhook endpoint
- M1.7 event processor
- M1.8 end-to-end send test

## Definition of done

Task is complete only when the migration is merged, validated locally, and the next milestone task is ready to start without guessing.
