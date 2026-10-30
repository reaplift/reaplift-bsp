# M1 test evidence

29 October 2026, branch `anirudh-e2e-setup`, local PostgreSQL 16 (`pnpm db:up`).

| Command          | Result                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| `pnpm lint`      | clean                                                                        |
| `pnpm typecheck` | clean                                                                        |
| `pnpm test`      | 37 passed (unit; includes `test/auth.test.ts`)                               |
| `pnpm test:int`  | 4 files, 32 passed (`login.int.test.ts`, `scope.int.test.ts`, migrate, seed) |

What the M1 tests cover, by task:

- 1.1 (`auth.test.ts`): argon2id hash, never the password, different each time; client user without a client, staff or super admin with one, and short passwords refused.
- 1.2 (`login.int.test.ts`): cookie flags; only the token's hash stored; body with `role` refused (400); wrong password 401; foreign or missing Origin 403; session survives a restart; logout then reuse 401; 12-hour idle expiry slides; 7-day hard limit; disabled user's sessions stop and login gives the same 401.
- 1.3 (`login.int.test.ts`): unknown email gives the same 401; 11th attempt after 10 failures is 423 even with the right password; unlocks after 15 minutes; success resets the count; failures spread over more than 15 minutes do not lock.
- 1.4 (`scope.int.test.ts`): workspaces per role; client, staff and super admin against own, assigned and unassigned clients; unknown and malformed IDs answer exactly like a forbidden one; suspended client 403 `CLIENT_SUSPENDED`; admin routes 403 for others, 401 without login.
- 1.5 (`scope.int.test.ts`): every registered route has an access rule; every client route answers 404 to another client's user; every admin route answers 403 to a client user and 401 without a login; `/api/me/` routes take no user ID from the path.
