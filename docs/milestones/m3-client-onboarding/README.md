# M3 client onboarding: prototype evidence (28 October 2026)

> This folder held the old "M2 admin onboarding" evidence. Milestones were renumbered on 29 October 2026; the current plan for this milestone is [spec.md](spec.md). The files below describe the in-memory prototype and will be rewritten as evidence when M3 is done.

## Business outcome

The platform owner can safely onboard a client, assign a staff owner, and activate or suspend the client without exposing admin controls to the wrong role.

## Active scope

This milestone covers only:

- login and role selection
- admin access gate
- client creation
- client list view
- client activation and suspension
- staff assignment to a client

This milestone intentionally excludes broader future work like wallet charging, message send, or Meta template approval.

## Pages in scope

### Login

- Purpose: sign in as a chosen role
- Current status: live demo flow with valid credentials, session creation, and role-based access enforcement

### Admin

- Purpose: create clients, review the client list, toggle status, and assign staff
- Current status: authenticated admin flow is working locally through real bearer-token-protected routes

## Backend in scope

Current routes for this slice:

- GET /api/admin/clients
- POST /api/admin/clients
- PATCH /api/admin/clients/:id/status
- PATCH /api/admin/clients/:id/staff

## Data contract in scope

Shared schema:

- id
- name
- contactEmail
- assignedStaff
- status
- walletBalance

## Acceptance for this milestone

The milestone is complete only when:

- login requires valid credentials and rejects invalid input
- role selection maps to the correct access page
- admin-only actions are blocked for non-admin users
- client creation updates real server state
- status changes persist correctly
- staff assignment persists correctly
- the flow can be demonstrated end to end without hidden mock state

## Evidence pack

- [test-evidence.md](./test-evidence.md)
- [frontend.md](./frontend.md)
- [backend-api.md](./backend-api.md)
- [database.md](./database.md)
- [e2e.md](./e2e.md)
