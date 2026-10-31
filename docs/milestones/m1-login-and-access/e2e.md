# M1 demo: run end to end (task 1.7, C1)

Run on 30 October 2026, 10:38 to 10:45 UTC, on a local machine, with the panel in real mode (`VITE_API_MODE` unset) through Vite's `/api` proxy, against the server on branch `m1-1.7-connect-real-server` (backend as on `anirudh-e2e-setup` at `6fa3443`). Requests that change state send `Origin: http://localhost:5173`. Cookie values are not recorded. Client IDs are from this run's database.

## Contracts

Before the demo, every auth response was checked against `packages/shared/src/contracts/auth.ts`. All matched, so no contract or mock changed in 1.7:

| Request                                         | Status | Contract                                 |
| ----------------------------------------------- | ------ | ---------------------------------------- |
| `POST /api/auth/login`, each of the four users  | 200    | `LoginResponse`                          |
| `GET /api/auth/me`, each of the four users      | 200    | `MeResponse`                             |
| `POST /api/auth/logout`, each of the four users | 204    | no body                                  |
| Login, wrong password                           | 401    | `ApiErrorBody`                           |
| Login with a `role` field                       | 400    | `ApiErrorBody`                           |
| `/me` and logout without a session              | 401    | `ApiErrorBody`                           |
| Login from `Origin: https://evil.example`       | 403    | `ApiErrorBody`                           |
| Login while locked (step 4)                     | 423    | `LoginLockedBody` (panel shows the time) |

## 1. Seed, start the server and panel

The local database was emptied (`docker compose -f infra/compose.dev.yml down -v`), then `pnpm db:up`, `pnpm migrate` (0001 to 0005 applied), `pnpm --filter @reaplift/server cli seed-dev` ("Seeded 3 clients and 4 users"), `pnpm dev`.

Database after the seed: clients Bluebird Retail, Greenleaf Foods, Northwind Labs; users `meera@reaplift.com` (staff, assigned Bluebird Retail and Northwind Labs), `ops@northwind.com` (client), `ravi@reaplift.com` (super_admin), `sales@greenleaf.in` (client).

## 2. Each user logs in through the panel

Each login was `POST /api/auth/login` 200 then `GET /api/auth/me` 200 from the real server. What each user saw is in [frontend.md](frontend.md#17-against-the-real-server), with screenshots.

| User                 | Lands on                                         | Menu                                                           | Picker                                                       |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `ops@northwind.com`  | `/clients/863644dc-…/dashboard`, Northwind Labs  | Dashboard, Push Campaign, Templates, Reports, Wallet, Settings | none                                                         |
| `sales@greenleaf.in` | `/clients/8f103585-…/dashboard`, Greenleaf Foods | same six                                                       | none                                                         |
| `meera@reaplift.com` | `/workspaces`; picked Bluebird Retail            | the six, no Admin; Switch client                               | Bluebird Retail, Northwind Labs                              |
| `ravi@reaplift.com`  | `/workspaces`; opened Admin                      | Admin                                                          | Bluebird Retail, Greenleaf Foods, Northwind Labs; Open Admin |

## 3. Another client's data with curl

Greenleaf Foods is `8f103585-f2ed-4b2d-851d-6e40f9c9dbb2`, Northwind Labs `863644dc-d19b-4796-9c1c-5ca2f02b7c56`, Bluebird Retail `784464c2-5993-43be-b7a4-8b322f2828b5`.

```
ops@northwind.com (session cookie from POST /api/auth/login)
GET /api/clients/8f103585-…                404 {"error":"NOT_FOUND","message":"Not found"}
GET /api/clients/8f103585-…/templates      404 (see note)
GET /api/clients/863644dc-…                200 {"clientId":"863644dc-…","name":"Northwind Labs","status":"active"}

meera@reaplift.com
GET /api/clients/8f103585-…                404 {"error":"NOT_FOUND","message":"Not found"}
GET /api/clients/784464c2-…                200 {"clientId":"784464c2-…","name":"Bluebird Retail","status":"active"}
GET /api/clients/00000000-0000-4000-8000-000000000000   404 {"error":"NOT_FOUND","message":"Not found"}
```

In the panel, Meera opening `/clients/8f103585-…/dashboard` is sent to her picker and nothing about Greenleaf is shown (checked on 30 October 2026 during S2).

Note for the backend: `/api/clients/<id>/templates` does not exist yet (M5), so its 404 is Fastify's default body `{"message":"Route GET:… not found","error":"Not Found","statusCode":404}`, not the `{ "error": "<CODE>", "message" }` shape the spec gives for all errors. It is still a 404 for every user, so nothing is revealed; the panel shows its general message for it.

## 4. Lockout

```
POST /api/auth/login sales@greenleaf.in, wrong password ×10     401 each
users.locked_until = 2026-10-30T10:58:33Z
POST /api/auth/login sales@greenleaf.in, right password, through the panel
423 → the panel shows "Too many failed logins. Locked until 16:28." (browser time zone Asia/Calcutta; 10:58 UTC)
```

## 5. Restart

Ravi was logged in on `/admin`. The server was stopped (10:42:37Z, `/healthz` unreachable) and started again (10:42:45Z, `/healthz` `{"status":"ok","db":"ok"}`). Reloading `/admin`: `GET /api/auth/me` 200, still logged in as Ravi on Administration. Screenshot: [c1-ravi-after-restart.jpg](screens/c1-ravi-after-restart.jpg).

## 6. Logout, then the old cookie

In the panel: Log out → `POST /api/auth/logout` 204, back on `/login`; opening `/admin` again → `GET /api/auth/me` 401 → `/login`.

With curl:

```
POST /api/auth/login ops@northwind.com     200, cookie rl_session
GET  /api/auth/me                          200
POST /api/auth/logout                      204, set-cookie: rl_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax
GET  /api/auth/me (same old cookie)        401 {"error":"UNAUTHENTICATED","message":"Please log in"}
```

## 7. Route-walking test in CI

CI run 41039409157 on PR #13 (commit `a5e4e7d`), job "pre-push review", step `pnpm test:int`:

```
✓ test/notifications.int.test.ts (12 tests)
✓ test/login.int.test.ts (14 tests)
✓ test/scope.int.test.ts (15 tests)    ← includes "1.5 every route has an access rule and enforces it"
✓ test/migrate.int.test.ts (2 tests)
✓ test/seed-account.int.test.ts (1 test)
Test Files  5 passed (5)   Tests  44 passed (44)
```

The spec's acceptance asks for this on the pull request into `main`. The panel's PRs go into `anirudh-e2e-setup` first (#12, #13, this one), so that last check was made on PR #15, from that branch into `main`: `scope.int.test.ts` passed all 15 tests on commit `7a827bd`, and M1 became Done when it merged on 30 October 2026.
