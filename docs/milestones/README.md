# Milestones

Each milestone is one flow and has its own folder with a `spec.md`. Status, order and the rules every milestone follows are in [project-tracker.md](../project-tracker.md). Every table and route is listed in [data-model-and-api.md](../data-model-and-api.md).

| Milestone | Spec                                                               |
| --------- | ------------------------------------------------------------------ |
| M0        | [Foundation](m0-foundation/spec.md)                                |
| M1        | [Login and access](m1-login-and-access/spec.md)                    |
| M2        | [Notifications](m2-notifications/spec.md)                          |
| M3        | [Client onboarding](m3-client-onboarding/spec.md)                  |
| M4        | [Send engine: one message end to end](m4-send-engine/spec.md)      |
| M5        | [Number connection and templates](m5-number-and-templates/spec.md) |
| M6        | [Wallet and prices](m6-wallet/spec.md)                             |
| M7        | [Campaigns: create, send, track](m7-campaigns/spec.md)             |
| M8        | [Campaign controls and rules](m8-campaign-controls/spec.md)        |
| M9        | [Reports and dashboard](m9-reports/spec.md)                        |
| M10       | [Cloud deploy](m10-cloud-deploy/spec.md)                           |
| M11       | [Pilot go-live](m11-pilot/spec.md)                                 |

## What every spec contains, in this order

1. **Header:** status, owner, starts after, external prerequisites.
2. **Outcome:** what the flow achieves, in two or three sentences.
3. **Flow diagram:** a Mermaid chart of the flow, including the failure paths. GitHub draws it; in VS Code install a Mermaid preview extension.
4. **Worked example:** the flow told with real-looking names and numbers, so anyone can check their understanding.
5. **Scope:** what is in, and what is out with the milestone it belongs to.
6. **Tasks:** a table showing which tasks can run in parallel, then each task with subtasks, tests and acceptance.
7. **Data and API:** tables, migrations, routes, error codes and settings.
8. **Notifications:** the events this milestone sends through M2, or "none".
9. **Open questions:** each with a default and who decides.
10. **Current reality:** what exists in the code today.
11. **Demo (milestone acceptance):** the exact steps that prove the flow. The milestone is Done when this passes and is recorded in `e2e.md`.

## Evidence pack

By the time a milestone is Done, its folder also holds:

- `test-evidence.md`: how to prove the flow works, so anyone can repeat it. It holds the setup, the exact copy-paste commands, the SQL queries that check the data, and the real output of each, plus the date and commit of the run and what was not run. See [M1's](m1-login-and-access/test-evidence.md) for the pattern.
- `frontend.md`: page actions and what each shows, when the milestone has screens
- `backend-api.md`: routes with real request and response examples, when the milestone has routes
- `e2e.md`: the demo run from panel to server to database

Never paste secrets or real client data into these files. Write them from a real run, not from memory.

## Running the project locally

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm migrate
pnpm --filter @reaplift/server cli seed-dev
pnpm dev
```

Panel: http://localhost:5173 (exactly this address; logins from any other are refused). Test logins and their password are in [M1's test evidence](m1-login-and-access/test-evidence.md). Health check: http://localhost:3000/healthz. Server logs appear in the terminal running the server.
