# Pre-push review checklist

This document is the quick gate before any branch is pushed. It keeps the workflow simple and consistent without adding heavy process.

## Goal

This is the repository's pre-push review gate and is also the CI-standard validation path for the repo.

The deterministic checks are automated by the script:

```bash
pnpm review:prepush
```

The tracker review is currently opt-in by default so exploratory work can proceed without a fully tracked task. Enable it when a feature is ready for a stricter review:

```bash
REVIEW_GATE=1 pnpm review:prepush
```

The hook is repo-shared, but the machine must still be activated locally. This is the setup every developer needs once on their machine:

```bash
git config core.hooksPath .githooks
```

On Windows, run the executable-bit step in Git Bash if needed:

```bash
chmod +x .githooks/pre-push
```

After that, the local git hook runs the same check only when the gate is enabled:

```bash
REVIEW_GATE=1 git push
```

Before a developer pushes, a lightweight review pass must confirm:

- the tracker is updated for the current work
- the active task includes explicit success criteria / acceptance criteria
- the change matches the task in the tracker
- the code is build-safe
- tests are present and meaningful
- no real money or live Meta messages are triggered by automation
- the branch is up to date with `main`
- the docs are still consistent with the implementation

## Required local checks

Run these locally before pushing:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

If the work touches DB and API behavior, also run:

```bash
pnpm db:up
pnpm test:int
```

If the feature is a server or build change, also confirm:

```bash
pnpm build
```

## Review agent prompt

Use this prompt before push:

```text
Review this branch for safety and correctness before push.
Check:
- is the tracker updated for the current work?
- does the active task include explicit success criteria or acceptance criteria?
- does the code match the active task in the tracker?
- is the diff scoped to the intended feature only?
- are lint, typecheck and tests passing?
- are integration tests included where DB/API boundaries are involved?
- is there any real Meta send, live webhook activity, or real wallet charge in automated tests?
- if design changed, were the docs updated in the same change set?
- are there hidden risks, missing validations, or unclear error handling?
Return PASS or FAIL with a short list of required fixes.
```

## Merge and safety rules

- Do not push a branch that is behind `main` without rebasing.
- Do not merge to `main` without a PR and review sign-off.
- Do not rely on local checks alone; CI is the final gate.
- Do not use automated tests to send real messages or burn real money.

## Example push sequence

```bash
git checkout main
git pull --ff-only origin main
git checkout -b anirudh-e2e-setup
# work, commit, then before push:

pnpm lint
pnpm typecheck
pnpm test

# if relevant:
pnpm db:up
pnpm test:int

git fetch origin
git rebase origin/main
git push -u origin anirudh-e2e-setup
```

## Review outcome

The branch is ready to push only when:

- all required checks pass
- the branch is rebased on `main`
- the tracker is updated
- the reviewer is satisfied
- the change is safe for CI and review

If any item fails, fix it before pushing.
