# Team workflow and Git policy

This repository is worked on by a small team, so we keep the Git flow simple and standard:

- `main` is the only protected release branch.
- Each developer keeps a personal working branch.
- We rebase from `main` before pushing.
- We never push directly to `main`.
- Review and CI must pass before merge.

We do not use one branch per task in this repo. A task-per-branch model creates branch churn for a two-person team and makes handoff harder. The tracker remains the source of truth for what task is active; the branch is just where the current developer is working.

## Branch model

Use a non-`main` branch for every change. Example names:

- `anirudh-e2e-setup`
- `feature/meta-config`
- `fix/send-validation`

The exact naming convention is flexible, but the rule is fixed: do not push directly to `main`.

## Required workflow before every push

Run these commands in order before pushing a branch:

```bash
git checkout main
git pull --ff-only origin main
git checkout -b anirudh-e2e-setup
# or: git checkout -b feature/meta-config
# work on the branch and commit locally

git status
git add -A
git commit -m "Describe the change"

git fetch origin
git rebase origin/main
# resolve any conflicts locally
# continue the rebase until it finishes

pnpm review:prepush

git push -u origin anirudh-e2e-setup
```

Set the local Git hook once per repo clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

If the push is rejected because the branch is behind `main`, do not force-push blindly. Rebase again and resolve the conflict before trying again.

## Conflict handling

Conflicts are normal when two people work in the same area. We keep the process simple:

- rebase from `main` before pushing
- resolve conflicts locally before pushing
- keep the change small and easy to review
- do not bypass review because the branch is behind

This repo does not treat same-file edits as a special case to avoid. We avoid silent overwrites by rebasing first and reviewing before merge.

## Pull request and merge rules

Before merge to `main`:

1. The branch is rebased on the latest `main`.
2. The PR is open and reviewed by the other developer.
3. CI is green.
4. The tracker task is updated to the correct state.
5. Only then is the branch merged to `main`.

Direct pushes to `main` are not allowed.

## After merge

After the branch is merged, switch back to `main` and sync it:

```bash
git checkout main
git pull --ff-only origin main
```

## Review checklist before pushing

Before pushing, confirm all of the following:

- the work matches the active tracker task
- the diff is limited to the intended scope
- tests are present and relevant
- lint, typecheck and relevant tests pass locally
- no real Meta send or real wallet charge is triggered by automated tests
- any design change is reflected in the docs
- the branch is updated with the latest `main`

## Relationship with tracker and docs

The tracker still tells us what is active and what has been done. The Git flow is deliberately simple so the team can work without branch sprawl.

If the task is blocked or design changes, update the tracker and the relevant design doc in the same change set.
