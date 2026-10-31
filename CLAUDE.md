# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

ReapLift's own WhatsApp Business platform (BSP), talking directly to Meta's WhatsApp Cloud API: template campaigns, prepaid client wallets in rupees, delivery reports. Read these before starting any task:

- `docs/project-tracker.md`: overall status, the roadmap, the dependency rule, owner decisions, and the rules every milestone follows. Source of truth for what is active.
- `docs/data-model-and-api.md`: every table and route, existing and planned, and the conventions they follow.
- `docs/milestones/<milestone>/spec.md`: the spec for the milestone you are working on (flow diagram, worked example, tasks, tests, demo).
- `docs/requirements-and-hld.md`: requirements and high-level design. Section 12 lists open items, which are NOT decided. Where the tracker's decision log differs, the tracker wins.
- `docs/open-questions.md`: questions waiting on ReapLift or Meta. Add new ones there.
- `docs/low-level-design.md`: technical reference. Its milestone numbers are the old ones (before 29 October 2026); the tracker has the old-to-new table.

## Where things stand

- Milestones were renumbered on 29 October 2026: one milestone per flow, M0 to M11. See the tracker's roadmap and status board.
- M0 (foundation) and M1 (login) are done. M2 (notifications) is built; only its real-email demo is left (E5). Anirudh builds the remaining backend (M3, M6 to M9) milestone by milestone; Suraj is on screens.
- Everything runs locally. The cloud server and deploys are M10.

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
- Every table carries `client_id` and every query filters by it. The only exceptions are the platform tables listed under "Tables without a client" in `docs/data-model-and-api.md`.
- Every task ships with its tests. Run lint, typecheck and tests before committing. `pnpm test:int` drops the schema of its database, so locally give it a separate `DATABASE_URL`.
- A milestone's `test-evidence.md` holds the exact commands, SQL queries and real output that prove its flow.
- Two branches only: all work is committed to `anirudh-e2e-setup`; `main` is production and changes only through a release pull request from it. No per-task branches, never force-push the work branch, never push to `main` directly. CI must be green. Steps are in `docs/team-workflow.md`.
- Never commit secrets. Settings go in `.env` (ignored); add every new setting name to `.env.example` with a blank value.
- Meta error codes, limits and rates in the design are from memory: check Meta's current docs before relying on them.
- Do not mark a task complete from a mock UI or in-memory route alone; require the full flow to be validated end to end.
- Do not mix future milestones into the active task. Keep scope narrow and current.
- Before calling a task done, check: real UI behavior, real backend request/response, role enforcement, and test evidence.
- If any hard check fails, the task remains in progress or prototype, not done.
