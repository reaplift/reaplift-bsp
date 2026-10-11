# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

ReapLift's own WhatsApp Business platform (BSP), talking directly to Meta's WhatsApp Cloud API: template campaigns, prepaid client wallets in rupees, delivery reports. Read these before starting any task:

- `docs/requirements-and-hld.md`: requirements and high-level design. Sections 1-11 are decided; section 12 lists open items, which are NOT decided.
- `docs/low-level-design.md`: the build plan. Milestones 0-8, each split into tasks with tests and acceptance criteria. Work task by task in that order.

## Where things stand

- Milestone 0 tasks 0.1, 0.2, 0.3, 0.7 are done: monorepo skeleton, `/healthz`, SQL migration runner, CI.
- Oracle Cloud tasks (0.4, 0.5, 0.6, 0.8) are deferred until a server exists. Everything runs locally for now.
- Next: milestone 1 (one message end to end), starting with task 1.2 (migration 0002). Task 1.1 (Meta app, number, token) is done by ReapLift outside the code.

## Stack

pnpm workspaces, TypeScript, Node 22. `apps/server`: Fastify, Zod, Kysely, pg, pino, Vitest. `apps/web`: React + Vite. `packages/shared`: types and Zod schemas shared by both. PostgreSQL 16 via Docker Compose (`infra/compose.dev.yml`).

## Commands (repo root)

- `pnpm install` / `pnpm dev` / `pnpm build`
- `pnpm db:up` / `pnpm db:down`: local PostgreSQL in Docker
- `pnpm migrate`: apply `db/migrations/*.sql`
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit), `pnpm test:int` (needs `pnpm db:up`)
- Build `packages/shared` first (`pnpm --filter @reaplift/shared build`) after changing it.

## Rules

- One server program; `MODE` (`api | worker | receiver | scheduler | migrate`) picks what runs. Add new behaviour as a mode or a module under `apps/server/src/modules/`, not as a separate app.
- Migrations: new numbered file only, never edit a merged one; only add things (tables, nullable columns, indexes).
- Money is whole paise in `bigint`. Phone numbers are digits with country code, no plus (`9198xxxxxxxx`).
- Every table carries `client_id` and every query filters by it.
- Every task ships with its tests from the low-level design. Run lint, typecheck and tests before committing.
- Work on a branch per task (`m1-1.2-migration-0002`), open a pull request into `main`, never push to `main` directly. CI must be green.
- Never commit secrets. Settings go in `.env` (ignored); add every new setting name to `.env.example` with a blank value.
- Meta error codes, limits and rates in the design are from memory: check Meta's current docs before relying on them.
