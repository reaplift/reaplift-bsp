# M1 test evidence

Every command and query needed to prove M1 works, with the output from a real run. Run on 30 October 2026 at commit `1bd372d`, against a freshly migrated and seeded database. IDs differ on every database. The panel run is in [e2e.md](e2e.md), and more request examples are in [backend-api.md](backend-api.md).

## Set up

Run from the repo root. All four users have the password `reaplift-dev-1`.

```bash
pnpm db:up
pnpm migrate
pnpm --filter @reaplift/server cli seed-dev
pnpm dev
```

In a second terminal, paste these helpers:

```bash
A=http://localhost:3000
sql() { docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "$1"; }
sqlv() { docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -Atc "$1"; }
login() { curl -si -X POST $A/api/auth/login -H 'content-type: application/json' -H 'origin: http://localhost:5173' -d "{\"email\":\"$1\",\"password\":\"$2\"}"; }
cookie() { login "$1" reaplift-dev-1 | tr -d '\r' | sed -n 's/^set-cookie: \(rl_session=[^;]*\).*/\1/p'; }
get() { curl -si "$A$1" -H "cookie: $2"; }

OPS=$(cookie ops@northwind.com); MEERA=$(cookie meera@reaplift.com); RAVI=$(cookie ravi@reaplift.com)
NW=$(sqlv "select id from clients where name='Northwind Labs'")
GL=$(sqlv "select id from clients where name='Greenleaf Foods'")
BB=$(sqlv "select id from clients where name='Bluebird Retail'")
```

## 1. Users are in the database, and passwords are hashed

```sql
select u.email, u.role, u.status, c.name as client
from users u left join clients c on c.id = u.client_id order by u.email;
```

```
       email        |    role     | status |     client
--------------------+-------------+--------+-----------------
 meera@reaplift.com | staff       | active |
 ops@northwind.com  | client      | active | Northwind Labs
 ravi@reaplift.com  | super_admin | active |
 sales@greenleaf.in | client      | active | Greenleaf Foods
```

```sql
select left(password_hash, 9) as hash_starts, length(password_hash) as hash_length,
  password_hash like '%reaplift-dev-1%' as contains_password
from users order by email limit 1;
```

```
 hash_starts | hash_length | contains_password
-------------+-------------+-------------------
 $argon2id   |          97 | f
```

## 2. Each role sees only what it should

```sql
select u.email, c.name as can_open
from staff_clients s join users u on u.id = s.staff_user_id join clients c on c.id = s.client_id
order by c.name;
```

```
       email        |    can_open
--------------------+-----------------
 meera@reaplift.com | Bluebird Retail
 meera@reaplift.com | Northwind Labs
```

| Check                                | Command                            | Result                                          |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------- |
| Client gets one workspace            | `get /api/auth/me "$OPS"`          | 200, `workspaces` holds only Northwind Labs     |
| Client opens own client              | `get /api/clients/$NW "$OPS"`      | 200                                             |
| Client opens another client          | `get /api/clients/$GL "$OPS"`      | 404 `NOT_FOUND`                                 |
| Staff opens assigned client          | `get /api/clients/$BB "$MEERA"`    | 200                                             |
| Staff opens unassigned client        | `get /api/clients/$GL "$MEERA"`    | 404 `NOT_FOUND`                                 |
| Super admin opens any client         | `get /api/clients/$GL "$RAVI"`     | 200                                             |
| Super admin opens admin route        | `get /api/admin/clients "$RAVI"`   | 200                                             |
| Client opens admin route             | `get /api/admin/clients "$OPS"`    | 403 `Only a super admin can do this`            |
| No login                             | `curl -si $A/api/auth/me`          | 401 `UNAUTHENTICATED`                           |

`GET /api/admin/clients` proves the access rule only. Its data is still M3's hardcoded prototype list (`cli-seed-001`), not the `clients` table.

## 3. Bad logins are refused

| Check                 | Command                                                                                                                                                         | Result                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Wrong password        | `login ops@northwind.com wrong-password`                                                                                                                        | 401 `INVALID_CREDENTIALS`             |
| Other website         | `curl -si -X POST $A/api/auth/login -H 'content-type: application/json' -H 'origin: https://evil.example' -d '{"email":"ops@northwind.com","password":"reaplift-dev-1"}'` | 403 `Request origin not allowed`      |
| Panel on another port | The same command with `origin: http://localhost:5174`                                                                                                           | 403 `Request origin not allowed`      |

The panel must be opened at exactly `http://localhost:5173`. If Vite moved to another port, or the address is `127.0.0.1`, login fails with "You do not have access to this." Stop the other copy and restart.

## 4. Sessions are stored as hashes

```sql
select u.email, count(*) as sessions, count(s.revoked_at) as revoked,
  bool_and(length(s.token_hash) > 0) as has_hash
from auth_sessions s join users u on u.id = s.user_id
group by u.email order by u.email;
```

```
       email        | sessions | revoked | has_hash
--------------------+----------+---------+----------
 meera@reaplift.com |        1 |       0 | t
 ops@northwind.com  |        2 |       0 | t
 ravi@reaplift.com  |        1 |       0 | t
```

## 5. Lockout after 10 failures

This locks `sales@greenleaf.in` for 15 minutes.

```bash
for i in $(seq 1 10); do login sales@greenleaf.in wrong-password > /dev/null; done
login sales@greenleaf.in reaplift-dev-1
```

```
HTTP/1.1 423 Locked
{"error":"LOGIN_LOCKED","message":"Too many failed logins; try again later","lockedUntil":"2026-10-31T04:19:49.651Z"}
```

```sql
select email, failed_login_count, locked_until is not null as locked
from users where email = 'sales@greenleaf.in';
```

```
       email        | failed_login_count | locked
--------------------+--------------------+--------
 sales@greenleaf.in |                    | t
```

To unlock it sooner on a local database:

```sql
update users set failed_login_count = null, first_failed_login_at = null, locked_until = null
where email = 'sales@greenleaf.in';
```

## 6. Sessions survive a restart, and logout ends them

Restart `pnpm dev`, then:

```bash
get /api/auth/me "$RAVI"                                                         # 200
curl -si -X POST $A/api/auth/logout -H 'origin: http://localhost:5173' -H "cookie: $RAVI"   # 204
get /api/auth/me "$RAVI"                                                         # 401 UNAUTHENTICATED
```

```sql
select u.email, s.revoked_at is not null as revoked
from auth_sessions s join users u on u.id = s.user_id
where u.email = 'ravi@reaplift.com';
```

```
       email       | revoked
-------------------+---------
 ravi@reaplift.com | t
```

## 7. Logs hold no secrets

During this run the API log had no line containing the password or the `rl_session` cookie. Each request logs `incoming request` and `request completed` with method, URL and status, and never the body.

## 8. Automated tests

| Command                                                 | Result                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`                           | clean                                                                                    |
| `pnpm test`                                             | shared 19, server 41, web 95, all pass                                                   |
| `DATABASE_URL=<a separate test database> pnpm test:int` | 6 files, 46 tests, all pass, including `login.int.test.ts` (14) and `scope.int.test.ts` (15) |

`pnpm test:int` drops the schema of the database it runs on; see [M0's test evidence](../m0-foundation/test-evidence.md) for the safe command. On PR #15 into `main`, CI passed `scope.int.test.ts` with all 15 tests, at commit `7a827bd`.

What the tests cover, by task:

- 1.1 (`auth.test.ts`): argon2id hash, never the password, different each time; client user without a client, staff or super admin with one, and short passwords refused.
- 1.2 (`login.int.test.ts`): cookie flags; only the token's hash stored; body with `role` refused (400); wrong password 401; foreign or missing Origin 403; session survives a restart; logout then reuse 401; 12-hour idle expiry slides; 7-day hard limit; disabled user's sessions stop and login gives the same 401.
- 1.3 (`login.int.test.ts`): unknown email gives the same 401; 11th attempt after 10 failures is 423 even with the right password; unlocks after 15 minutes; success resets the count; failures spread over more than 15 minutes do not lock.
- 1.4 (`scope.int.test.ts`): workspaces per role; client, staff and super admin against own, assigned and unassigned clients; unknown and malformed IDs answer exactly like a forbidden one; suspended client 403 `CLIENT_SUSPENDED`; admin routes 403 for others, 401 without login.
- 1.5 (`scope.int.test.ts`): every registered route has an access rule; every client route answers 404 to another client's user; every admin route answers 403 to a client user and 401 without a login; `/api/me/` routes take no user ID from the path.
- 1.6 (`apps/web/test/`): API layer, mock mode, error messages, login page including the show/hide password button, and routes per role.
- `users.created_by` (`users.int.test.ts`): records which super admin added a user; refuses an ID that is not a real user.
