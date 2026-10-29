# M1. Login and access

- Status: In progress (prototype: three demo users and sessions held in memory)
- Owner: Anirudh (to confirm)
- Branch prefix: `m1-`
- Starts after: M0
- External prerequisites: none

## Outcome

A super admin, a staff member and a client user each log in with their own email and password and land in the right place. A client user sees only their own client's workspace. A staff member sees only the clients assigned to them. The server, not the panel, enforces this, and a test proves one client can never read another client's data.

## Flow diagram

```mermaid
flowchart TD
  A["User opens the panel"] --> B["Login: email + password"]
  B --> C{"Server checks users table<br/>(argon2id hash)"}
  C -- "wrong password" --> D["401, failure counted"]
  D --> E{"10 failures in 15 min?"}
  E -- "yes" --> F["423: locked for 15 minutes"]
  E -- "no" --> B
  C -- "user disabled" --> G["401, same message"]
  C -- "correct" --> H["Session row saved;<br/>httpOnly cookie set"]
  H --> I{"Role?"}
  I -- "client" --> J["Workspace fixed to own client"]
  I -- "staff" --> K["Pick one of the assigned clients"]
  I -- "super_admin" --> L["Pick any client, or open Admin"]
  J --> M["Pages show only that client's data"]
  K --> M
  L --> M
  M --> N{"Request for another client's ID?"}
  N -- "yes" --> O["404 NOT_FOUND<br/>(server never reveals it exists)"]
  N -- "no" --> P["Data returned"]
  M --> Q["Logout: session revoked, cookie cleared"]
```

## Worked example

Accounts (created by the seed command in 1.1, because the admin screens arrive in M3):

| Email                | Role          | Clients                         |
| -------------------- | ------------- | ------------------------------- |
| `ravi@reaplift.com`  | `super_admin` | all                             |
| `meera@reaplift.com` | `staff`       | Northwind Labs, Bluebird Retail |
| `ops@northwind.com`  | `client`      | Northwind Labs                  |
| `sales@greenleaf.in` | `client`      | Greenleaf Foods                 |

1. `ops@northwind.com` logs in. The panel opens Northwind's Dashboard. There is no client picker and no Admin menu.
2. The same user edits the URL to `/api/clients/<Greenleaf id>/templates`. The server answers 404, the same answer as for an ID that does not exist.
3. `meera@reaplift.com` logs in and sees a picker with Northwind and Bluebird only. She picks Bluebird; every page now shows Bluebird's data. Greenleaf is not in her list and its URLs return 404.
4. `ravi@reaplift.com` logs in, sees all three clients in the picker and the Admin menu.
5. Someone types a wrong password for `sales@greenleaf.in` ten times in five minutes. The eleventh attempt, even with the right password, gets "locked, try again in 15 minutes".
6. The server restarts. Everyone who was logged in is still logged in, because sessions are in PostgreSQL.

## Scope

In:

- real users with hashed passwords; a command to create users
- server-side sessions in an httpOnly cookie; logout; expiry; lockout
- the request scope every later milestone uses (below), with client workspaces
- a test that walks every route as the wrong client
- the panel shell: login page, client picker, menu by role, "coming soon" for pages not built yet

Out:

- creating clients, users and staff assignments in the panel: [M3](../m3-client-onboarding/spec.md)
- password reset by the super admin: M3
- the "login locked" email: M3's notification task (M1 does not start after M2, so it cannot send notifications)
- self-service password reset by email: later, not planned

## The scope contract (used by every milestone)

- Every route that touches a client's data has the client in its path: `/api/clients/:clientId/...`. Admin routes are `/api/admin/...`. The logged-in user's own data (password, notifications) is under `/api/me/...` and every query there filters by the user's ID. There is no other pattern.
- One Fastify hook resolves the scope before any handler runs and passes it on the request: `{ userId, role, clientId }`.
  - `client`: `clientId` in the path must equal the user's own client.
  - `staff`: `clientId` must be in the user's `staff_clients` rows.
  - `super_admin`: any existing client.
  - Anything else: 404 `NOT_FOUND`. Never 403 for another client's data, so the server never confirms that an ID exists.
- Every query takes `clientId` from the scope, never from the request body.
- `/api/admin/*` routes accept `super_admin` only and return 403 `FORBIDDEN` to others.

## Tasks

| Task | Name                                   | Depends on                                 | Can run in parallel with |
| ---- | -------------------------------------- | ------------------------------------------ | ------------------------ |
| 1.0  | Restore green CI                       | none                                       | all                      |
| 1.1  | Users, password hashing, `create-user` | none                                       | 1.6                      |
| 1.2  | Cookie sessions, logout, expiry        | 1.1                                        | 1.6                      |
| 1.3  | Lockout                                | 1.2                                        | 1.4                      |
| 1.4  | Request scope and client workspaces    | 1.2                                        | 1.3                      |
| 1.5  | Route-walking isolation test           | 1.4                                        | 1.6                      |
| 1.6  | Panel shell: login, picker, menu       | none (calls 1.2 and 1.4 routes when ready) | 1.1 to 1.5               |

### 1.0 Restore green CI

- Fix the three lint errors in existing code (`app.ts` line 111 `any`, line 223 unused `received`; `apps/web/src/App.tsx` line 2 unused `AppPageId`) and the typecheck error in `lib/auth.ts` line 25.
- Acceptance: `pnpm lint`, `pnpm typecheck` and `pnpm test` pass on `main`.

### 1.1 Users, password hashing, `create-user`

- 1.1.1 Passwords hashed with argon2id; plain passwords never logged or stored.
- 1.1.2 Command `pnpm --filter @reaplift/server cli create-user --email --name --role [--client]`, which prompts for the password. Creating a `client` user requires `--client`; `super_admin` and `staff` must not have one.
- 1.1.3 A dev seed script creates the four users in the worked example and their clients and staff assignments.
- 1.1.4 The role is `client` everywhere (database, shared types, panel). Rename `client_admin` in `packages/shared` and the panel.
- 1.1.5 Remove the hardcoded demo users from `app.ts`.
- Tests: the hash is not the password; the same password hashes differently twice; a `client` user without a client is refused.
- Acceptance: users created by the command can log in; no demo users remain in the code.

### 1.2 Cookie sessions, logout, expiry

- 1.2.1 New table `auth_sessions` (migration 0004, see "Data"). The existing `sessions` table from 0003 is not used, because its `client_id` is `not null` and a super admin has no client; migrations may only add, so a new table is the clean fix.
- 1.2.2 Login creates a random 32-byte token, stores only its SHA-256 hash, and sets cookie `rl_session`: httpOnly, Secure (except on localhost), SameSite=Lax, path `/`.
- 1.2.3 Sessions last 12 hours from the last request, and at most 7 days in total.
- 1.2.4 Logout sets `revoked_at` and clears the cookie.
- 1.2.5 State-changing requests (POST, PUT, PATCH, DELETE) must carry an `Origin` header matching the panel's address, which blocks cross-site requests that ride on the cookie.
- 1.2.6 Login body is `{ email, password }` only; the prototype's `role` field is removed.
- Tests: wrong password gives 401; logout then reuse gives 401; an expired session gives 401; a request with a foreign `Origin` gives 403; a session survives a server restart.
- Acceptance: a user stays logged in across a restart and is logged out everywhere the session was revoked.

### 1.3 Lockout

- 10 failed logins for one email within 15 minutes lock that login for 15 minutes, even with the right password. A successful login resets the count.
- The response for an unknown email, a wrong password and a disabled user is the same 401 `INVALID_CREDENTIALS`, so nobody can test which emails exist. A locked account gets 423 `LOGIN_LOCKED` with the unlock time.
- Data: nullable columns on `users`: `failed_login_count int`, `locked_until timestamptz` (migration 0004).
- Tests: the 11th attempt is locked; the lock ends after 15 minutes (fake clock); success resets the count.
- Acceptance: the worked example's step 5 behaves as written.

### 1.4 Request scope and client workspaces

- 1.4.1 The scope hook described in "The scope contract".
- 1.4.2 `GET /api/auth/me` returns the user and their workspaces: `{ user: { id, name, email, role }, workspaces: [{ clientId, name, status }] }`. A client user gets one; staff get their assigned clients; super admin gets all.
- 1.4.3 A suspended client's users can log in but get 403 `CLIENT_SUSPENDED` on every client route (the suspend action itself is built in M3).
- Tests: each role against its own, an assigned, and an unassigned client.
- Acceptance: the worked example's steps 1 to 4 behave as written, through real routes.

### 1.5 Route-walking isolation test

- A test reads every route registered on the Fastify app. For every `/api/clients/:clientId/...` route it calls it as Northwind's user with Greenleaf's client ID and expects 404. For every `/api/me/...` route it checks that user A cannot read user B's rows. A route that is not under `/api/clients/`, `/api/admin/`, `/api/me/` or the public list (`/healthz`, `/api/auth/*`, `/webhooks/meta`) fails the test.
- This test runs in CI forever, so every later milestone's routes are checked automatically.
- Acceptance: adding a route without scope makes CI red.

### 1.6 Panel shell: login, picker, menu

- Login page posts `{ email, password }`; shows "wrong email or password" or "locked until hh:mm".
- After login the panel calls `/api/auth/me`. One workspace: open it. Several: show the picker; the chosen client appears in the header with a switch button.
- Menu by role, following the Dovesoft sidebar (HLD section 4): Dashboard, Push Campaign, Templates, Reports, Wallet, Settings for a workspace; Admin for super admin only. Pages not built yet show "coming soon".
- Dashboard and Push Campaign stop showing `apps/web/src/data/mockData.ts` figures; they show an empty state until their milestones.
- Tests: component tests for the menu by role and the picker.
- Acceptance: each user in the worked example sees exactly the menu and picker described.

## Data and API

Migration 0004 (claim it in the tracker's registry first):

- `auth_sessions`: `id uuid`, `user_id uuid not null`, `client_id uuid null` (the user's client for client users; kept so the table carries `client_id` like every table), `token_hash text not null unique`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at null`, `user_agent text null`, `ip_address text null`
- `users`: add nullable `failed_login_count int`, `locked_until timestamptz`

| Method | Route              | Who       | Success                 | Errors                                                               |
| ------ | ------------------ | --------- | ----------------------- | -------------------------------------------------------------------- |
| POST   | `/api/auth/login`  | anyone    | 200 user; sets cookie   | 400 `INVALID_REQUEST`, 401 `INVALID_CREDENTIALS`, 423 `LOGIN_LOCKED` |
| POST   | `/api/auth/logout` | logged in | 204; clears cookie      | 401 `UNAUTHENTICATED`                                                |
| GET    | `/api/auth/me`     | logged in | 200 user and workspaces | 401 `UNAUTHENTICATED`                                                |

All errors use `{ "error": "<CODE>", "message": "<text>" }`.

Settings: `SESSION_COOKIE_SECURE`, `PANEL_ORIGIN` (added to `.env.example` blank).

## Notifications

None in M1. The "login locked" email is sent from M3 task 3.6.

## Open questions

None. The role name, session table and cookie were decided on 29 October 2026 (see the tracker's decision log).

## Current reality

- `POST /api/auth/login` in `apps/server/src/app.ts` checks three hardcoded users (`admin@`, `client@`, `staff@reaplift.ai`, password `password123`) and a `role` field, and keeps sessions in a `Map` with an 8-hour expiry, sent as a bearer token. A restart logs everyone out.
- `/api/admin/*` routes check for a `super_admin` session; the panel hides pages with `canAccessPage` from `packages/shared`.
- Tables `users`, `sessions`, `staff_clients`, `audit_logs` exist (0003); nothing reads them.
- No hashing, logout, lockout, scope hook or isolation test.

## Demo (milestone acceptance)

1. Run the dev seed (1.1.3). Start the server and panel.
2. Log in as each of the four users in the worked example; record what each sees (screenshots in `frontend.md`).
3. As `ops@northwind.com`, call a Greenleaf route with `curl` and the session cookie; record the 404.
4. Lock `sales@greenleaf.in` with 10 wrong passwords; record the 423.
5. Restart the server; reload the panel; the user is still logged in.
6. Log out; reuse the old cookie with `curl`; record the 401.
7. CI shows the route-walking test passing.
