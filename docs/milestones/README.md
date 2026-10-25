# Milestone documentation index

Every milestone must ship with a small evidence pack so the flow can be reviewed quickly by engineering, PM, or demo stakeholders.

## Required deliverables for each milestone

Each milestone folder should contain:

- README.md — business goal, scope, pages, APIs, and data touched
- test-evidence.md — command output and proof that the flow validates
- frontend.md — page actions, UI flow, validation notes, and demo steps
- backend-api.md — route list, request/response examples, validation rules
- database.md — data model and table/query assumptions for the milestone
- e2e.md — end-to-end path from UI -> backend -> DB -> result

## Current milestone

- M2 admin onboarding and client activation
  - Folder: [docs/milestones/m2-admin-onboarding/README.md](m2-admin-onboarding/README.md)

## Local demo setup

For the current milestone, start the project like this from the repo root:

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm migrate
pnpm --filter @reaplift/server dev
pnpm --filter @reaplift/web dev
```

Open the app at http://localhost:5173. The backend health check is http://localhost:3000/healthz. The backend logs appear in the terminal where you ran `pnpm --filter @reaplift/server dev`; the frontend logs appear in the terminal where you ran `pnpm --filter @reaplift/web dev`. There is no separate log file in this milestone yet. Log in with:

- email: `admin@reaplift.ai`
- password: `password123`
- role: `super_admin`

This is the working demo flow for the current milestone: login, protected admin API, client list, create client, status toggle, and staff assignment.

## Rule

A milestone is not considered complete unless the evidence pack exists and the flow is validated end to end.
