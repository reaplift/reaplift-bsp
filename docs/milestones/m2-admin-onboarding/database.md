# Database and data model notes

## Current milestone data assumptions

The active slice uses the shared AdminClient schema for the client object:

- id
- name
- contactEmail
- assignedStaff
- status
- walletBalance

## Current implementation note

This milestone is intentionally still in-memory. That means the server does not yet write to a real PostgreSQL table for this flow.

## Future database work when this milestone is complete

When the milestone is ready to move beyond prototype, the following data model work should be added in the real DB layer:

- clients table
- staff assignments table or join table
- client status history or audit log table
- client_id scoping on all selects and writes
- indexes for fast admin list queries

## Guardrail

No database tables should be created for future milestones while this task is still active.
