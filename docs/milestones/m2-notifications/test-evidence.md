# M2 test evidence

29 October 2026, branch `anirudh-e2e-setup`, local PostgreSQL 16 (`pnpm db:up`).

| Command          | Result                                                    |
| ---------------- | --------------------------------------------------------- |
| `pnpm lint`      | clean                                                     |
| `pnpm typecheck` | clean (includes the "notify() needs a transaction" check) |
| `pnpm test`      | 41 passed (unit; includes `test/notifications.test.ts`)   |
| `pnpm test:int`  | 5 files, 44 passed (includes `notifications.int.test.ts`) |

What the M2 tests cover, by task:

- 2.1 (`notifications.test.ts`, `notifications.int.test.ts`): calling `notify()` with a plain Kysely instance instead of a transaction does not compile (`@ts-expect-error`, checked by `pnpm typecheck`); an unknown event is refused; a rolled-back transaction leaves no row (demo step 3); the same event twice writes one row, the replay writes none.
- 2.2 (`notifications.int.test.ts`): a pending email is sent once by the fake provider and marked `sent`; a later run sends nothing more; two delivery runs at the same time over 40 rows send each row exactly once; a failing provider is retried after exactly 30 s, 1, 2 and 4 minutes, a row is not claimed a second before it is due, and after 5 attempts the row is `failed` with the error and is never tried again.
- 2.3 (`notifications.int.test.ts`): `client_users` and `assigned_staff` return only that client's people; an event for Greenleaf never reaches Northwind's users or staff; `super_admins`, `actor` and `user`; an address found by two rules appears once; a disabled user gets nothing; a rule missing the scope it needs is an error.
- 2.4: run by hand, see `e2e.md`.
