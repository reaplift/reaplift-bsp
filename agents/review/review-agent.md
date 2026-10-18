# Review Agent

This is the repository's first agent. It enforces the pre-push review gate before code is pushed.

## Purpose

The review agent checks whether a branch is ready to be pushed and later merged.

It validates:

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
