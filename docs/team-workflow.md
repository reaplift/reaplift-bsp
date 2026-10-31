# Team workflow and Git policy

This repository is worked on by a small team, so we use two branches and nothing else:

- `anirudh-e2e-setup` is the work branch. Everyone commits here.
- `main` is production. It changes only through a release pull request from the work branch.

We do not use one branch per task, stacked branches, or a pull request per task. The tracker remains the source of truth for what task is active and what has been done.

## Daily work

Set the local Git hook once per repo clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-push
```

Then, for every piece of work:

```bash
git checkout anirudh-e2e-setup
git pull --rebase origin anirudh-e2e-setup

# work and commit locally

pnpm lint
pnpm typecheck
pnpm test

git pull --rebase origin anirudh-e2e-setup
git push origin anirudh-e2e-setup
```

Push small commits often, so the two of us stay close together. CI runs on every push to the work branch. If CI goes red, fixing it comes before any new work, because the branch is shared.

## Conflict handling

- `git pull --rebase` only moves your own commits that have not been pushed yet, so it is safe. Resolve any conflict locally and continue.
- Never force-push the work branch, and never rebase commits that are already pushed. Both rewrite the other person's history.
- If a push is rejected, pull with rebase again and push again.

## Releasing to production

1. CI is green on the latest commit of `anirudh-e2e-setup`, and the tracker matches the code.
2. Open one pull request from `anirudh-e2e-setup` into `main`. The other developer reviews it.
3. Merge with a merge commit, not "Squash and merge". A squash leaves the two branches with different histories, and the next release then conflicts.
4. Bring the merge commit back to the work branch, so it is not left behind `main`:

```bash
git checkout anirudh-e2e-setup
git pull --rebase origin anirudh-e2e-setup
git fetch origin
git merge origin/main
git push origin anirudh-e2e-setup
```

Direct pushes to `main` are not allowed.

## Review checklist before pushing

Before pushing, confirm all of the following:

- the work matches the active tracker task
- the diff is limited to the intended scope
- tests are present and relevant
- lint, typecheck and relevant tests pass locally
- no real Meta send or real wallet charge is triggered by automated tests
- any design change is reflected in the docs

## Relationship with tracker and docs

If a task is blocked or the design changes, update the tracker and the relevant design doc in the same commit.
