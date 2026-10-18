# ReapLift WhatsApp BSP by Anirudh and Suraj

ReapLift's own WhatsApp platform, working directly with Meta: template campaigns, prepaid client wallets, delivery reports. Design documents:

- Requirements and HLD: [docs/requirements-and-hld.md](docs/requirements-and-hld.md)
- Low-level design and milestones: [docs/low-level-design.md](docs/low-level-design.md) (online version: https://claude.ai/code/artifact/4b57f650-612d-47f8-aba6-ad9bcd98f47d)

Current state: **milestone 0 skeleton**. The server answers `/healthz` and runs database migrations; the panel is a placeholder page.

## Setup

Follow the guide for your computer. Each one covers installing the tools, opening the repo in VS Code, the first run and common problems.

- **Mac:** [docs/setup-mac.md](docs/setup-mac.md)
- **Windows:** [docs/setup-windows.md](docs/setup-windows.md)

You need Git, Node.js 22 (see `.nvmrc`), pnpm 10, Docker Desktop and VS Code. When it works, http://localhost:5173 shows `API: ok (version dev, database ok)`.

## Everyday commands

Run all of these from the repo root.

| Command                                                            | What it does                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `pnpm dev`                                                         | Runs the API and the panel with live reload                           |
| `pnpm db:up` / `pnpm db:down`                                      | Starts / stops the local PostgreSQL container (data is kept)          |
| `pnpm migrate`                                                     | Applies new files in `db/migrations` to the database                  |
| `pnpm test`                                                        | Unit tests (no database needed)                                       |
| `pnpm test:int`                                                    | Integration tests against the local database (`pnpm db:up` first)     |
| `pnpm lint`                                                        | ESLint over the whole repo                                            |
| `pnpm typecheck`                                                   | TypeScript checks for every package                                   |
| `pnpm build`                                                       | Production build of every package                                     |
| `pnpm format`                                                      | Formats every file with Prettier                                      |
| `docker compose -f infra/compose.dev.yml --profile app up --build` | Runs database, migrations and API all in containers, as on the server |

Health check: `curl http://localhost:3000/healthz` returns `{"status":"ok","version":"dev","db":"ok"}`, or HTTP 503 when the database is down.

## End-of-day shutdown

When you finish work for the day, stop the local app and database cleanly so nothing keeps running in the background:

```bash
# stop the dev server in the terminal where it is running
# press Ctrl+C

# stop the local Postgres container
pnpm db:down

# optional: quit Docker Desktop completely if you do not want background containers running
# Mac: open Docker Desktop and choose Docker Desktop > Quit Docker Desktop
```

This is the local equivalent of a clean shutdown before moving from laptop/dev work to a server or cloud deployment later.

## Repository layout

```
apps/
  server/             Node + Fastify (TypeScript). One program; MODE picks what it runs:
    src/main.ts         api | worker | receiver | scheduler | migrate
    src/app.ts          HTTP routes (now: /healthz)
    src/config.ts       settings read from the environment (.env)
    src/lib/            database, logger
    src/migrate/        SQL migration runner
    src/modes/          one file per mode
    test/               *.test.ts = unit, *.int.test.ts = needs the database
  web/                React + Vite panel
packages/
  shared/             Types and Zod schemas used by both server and panel
db/migrations/        Numbered SQL files: 0001_init.sql, 0002_..., applied in order, never edited after merge
infra/                Docker Compose for local development (Oracle Cloud files come later)
.github/workflows/    CI: lint, typecheck, tests with PostgreSQL, build, Docker image
Dockerfile            One image for every server mode
```

## Adding a database change

1. Add a new file `db/migrations/NNNN_short_name.sql` with the next number.
2. Only add things (tables, nullable columns, indexes). Removing something takes two releases.
3. Run `pnpm migrate`, then add the table's type to `apps/server/src/lib/db.ts`.

## Settings

Every setting is listed in `.env.example`. Copy it to `.env` for local work. `.env` is ignored by Git: **never commit secrets** (Meta tokens, passwords, keys).

## Working with Git

1. Create a branch per task: `git checkout -b m1-sender-worker`.
2. Commit, then `git push -u origin <branch>` and open a pull request into `main`.
3. CI must be green before merging. Merge with "Squash and merge".

## Working with Claude Code in VS Code

Open the repo folder in VS Code, open Claude Code, and ask for one task at a time from the low-level design, for example: "Do task 1.2 from the low-level design (migration 0002), with tests." Ask it to work on a branch and open a pull request.

## Milestones

| #   | Outcome                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- |
| 0   | Repo, structure, CI (done locally); deployment to Oracle Cloud later                                          |
| 1   | One message end to end: sent from the backend, delivered and read updates stored                              |
| 2-8 | Logins and roles, Meta number and templates, uploads and campaigns, sending and rules, wallet, reports, pilot |

> Milestone 0 skeleton branch.
