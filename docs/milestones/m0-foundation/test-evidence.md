# M0 test evidence

Run on 30 October 2026 at commit `1bd372d`, on an empty database, local PostgreSQL 16.

## Set up

Run from the repo root:

```bash
pnpm db:up
sql() { docker exec reaplift-bsp-postgres-1 psql -U reaplift -d reaplift -c "$1"; }
```

## 1. Migrations apply, and a second run changes nothing

```bash
pnpm migrate
pnpm migrate
```

The log line of the second run shows `"applied":[]`, with every file under `skipped`.

```sql
select name from schema_migrations order by name;
```

```
0001_init.sql
0002_message_platform.sql
0003_admin_access.sql
0004_auth_sessions.sql
0005_notifications.sql
0006_users_created_by.sql
```

## 2. The server and database are healthy

Start the server with `pnpm dev`, then:

```bash
curl -i http://localhost:3000/healthz
```

```
HTTP/1.1 200 OK
{"status":"ok","version":"dev","db":"ok"}
```

## 3. Automated checks

| Command                                                | Result                                 |
| ------------------------------------------------------ | -------------------------------------- |
| `pnpm lint`                                            | clean                                  |
| `pnpm typecheck`                                       | clean                                  |
| `pnpm test`                                            | shared 19, server 41, web 95, all pass |
| `DATABASE_URL=<a separate test database> pnpm test:int` | 6 files, 46 tests, all pass            |

**`pnpm test:int` drops the whole schema of the database it runs on.** Never point it at a database whose data you want to keep. To run it safely:

```bash
sql "create database reaplift_test"
DATABASE_URL=postgres://reaplift:reaplift@localhost:5432/reaplift_test pnpm test:int
sql "drop database reaplift_test"
```

CI runs all of these on every pull request and on every push to `main` and `anirudh-e2e-setup`.
