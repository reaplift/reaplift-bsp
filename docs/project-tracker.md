# Project tracker

TL;DR:
- This file is for repo-level task status, not local machine status.
- If it is about the codebase, it belongs here. If it is about one laptop or one developer session, it does not.
- Read this document first in every session. Update it when code is pushed or a task changes state.

## How to read this tracker

This tracker is the working source of truth for code tasks, blockers, and the next implementation step.

It does not mean:
- Docker Desktop is running on my machine
- the local Postgres container is up
- the dev server was started in this session
- every engineer has the same local state

It does mean:
- the code task is done, blocked, in progress, or ready
- the branch and repo state match the implementation status
- the next session can pick up from the latest task state without guessing

## Required local setup check

Before starting a new work session, ensure the following exist on this machine:

- Git
- Node.js 22 or newer
- pnpm
- Docker Desktop / Docker engine running
- GitHub CLI (`gh`)

Current environment status on this machine:
- Git: installed
- Node.js: installed
- pnpm: installed
- Docker: installed and running
- GitHub CLI: installed

If any are missing, install them first and confirm they work before touching code.

## Current status

| Milestone / task | Status | Evidence | Notes |
| --- | --- | --- | --- |
| M0.1 repo skeleton | Done | Repo is created and local toolchain works | Includes monorepo, server, web and shared package |
| M0.2 CI | Done | GitHub Actions workflow exists | PR-based validation is configured |
| M0.3 Docker / local server setup | Done | Docker Desktop and local Postgres work | Local dev environment runs on this machine |
| M0.7 migration runner | Done | `pnpm migrate` applies `0001_init.sql` | Local DB migration passes |
| M0.8 backup / Oracle Cloud setup | Deferred | Not needed for local dev | To be done later with infrastructure work |
| M1.1 Meta app and number setup | Blocked externally | Needs ReapLift account setup | Not a code task |
| M1.2 migration 0002 | Ready | Design and tests are defined | Next implementation task |
| M1.3 encryption + seed-account | Planned | Not started | Requires 0002 first |
| M1.4 Meta client and error classifier | Planned | Not started | Depends on 0002 and 1.3 |
| M1.5 sender worker | Planned | Not started | Depends on migration and config |
| M1.6 receiver and webhook endpoint | Planned | Not started | Requires Meta setup and tests |
| M1.7 event processor | Planned | Not started | Depends on receiver and schema |
| M1.8 send-test and show-message | Planned | Not started | Milestone end-to-end validation |

## Process docs

Before starting or pushing work, read the repo process docs first:

- [team-workflow.md](team-workflow.md): branch model, rebase-before-push rule, merge policy.
- [pre-push-review.md](pre-push-review.md): local checks and review gate before pushing.

## Session rules

Every session should do the following:

1. Read this tracker first.
2. Read the process docs for the branch and review policy.
3. Check the current branch and the latest pushed state.
4. Update the task status when work starts, changes, or is completed.
5. If code is pushed, update the tracker immediately so the next session knows the current repo state.
6. If a task is blocked, mark it `Blocked` and write the blocker clearly.
7. Do not mark a task `Done` unless the code is pushed and the validation has run.
8. Keep local-machine notes out of the tracker.

## Required update after every push

After any code push or merge, update this tracker with the exact status of the task that changed.

Use this pattern:

- `Status: In progress` when work has started
- `Status: Blocked` when an external dependency or missing setup prevents completion
- `Status: Done` only after validation and push are complete
- `Status: Ready` when the next task is prepared and waiting for implementation

The next session should be able to read this file and know exactly what is done, what is blocked, and what is next without asking the previous operator.

## Next action

The next implementation task is milestone 1, task 1.2: migration 0002. After that, the team should write the execution-ready implementation spec for 1.3 to 1.8 in the same format, with tests and acceptance checks for each task.
