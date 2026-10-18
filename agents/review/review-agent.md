# Review Agent

This is the repository's first agent. It enforces the pre-push review gate before code is pushed.

## Purpose

The review agent checks whether a branch is ready to be pushed and later merged.

It is opt-in by default while the repo is exploring rough work and tasks are not yet fully tracked. Enable it by setting `REVIEW_GATE=1` before running the review or pushing.

It validates:

- the tracker is updated for the current work
- the active task includes clear success criteria / acceptance criteria
- the change matches the active tracker task
- the diff is scoped and reviewable
- lint, typecheck and tests pass
- DB/API integration tests pass when needed
- no real Meta sends or real wallet charges are triggered during automation
- docs are updated when design changes
- the branch is rebased on the latest `main`

## Execution

Run the script directly:

```bash
node ./agents/review/review-agent.js
```

It also runs as part of the repo pre-push review gate:

```bash
pnpm review:prepush
```

Or from the repo script:

```bash
pnpm review:prepush
```

This is the repo-level enforcement checkpoint for the branch-protection workflow and is meant to stop unsafe pushes before they leave a developer machine.

## Required commands

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For DB/API work:

```bash
pnpm db:up
pnpm test:int
```

## Review prompt

```text
Review this branch for safety and correctness before push.
Check:
- is the tracker updated for the current work?
- does the active task in the tracker include explicit success criteria or acceptance criteria?
- does the code match the active task in the tracker?
- is the diff limited to the intended scope?
- are lint, typecheck and tests passing?
- are integration tests included where DB or API boundaries are involved?
- is there any real Meta send, live webhook activity, or wallet charge in automated tests?
- if the design changed, were docs updated in the same change set?
- is the branch rebased on the latest `main`?
Return PASS or FAIL with a short list of required fixes.
```

## Standard behavior

- Do not approve a branch that is behind `main`.
- Do not approve code with broken lint or tests.
- Do not approve a change that triggers real Meta or wallet activity in CI.
- Require doc updates when the design evolves.
- Keep the review focused and practical.

## Future extension

More agents can be added under `agents/` with the same structure: one markdown file for documentation and one executable JavaScript file for logic.
