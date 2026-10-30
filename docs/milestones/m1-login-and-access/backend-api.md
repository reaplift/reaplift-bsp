# M1 backend: real requests and responses

Recorded on 29 October 2026 against the live server (`pnpm --filter @reaplift/server dev`), after `pnpm migrate` on an empty database and `pnpm --filter @reaplift/server cli seed-dev`. Every request that changes state sends `Origin: http://localhost:5173`. IDs differ per run.

## Step 1: a client user logs in and sees one workspace

```
POST /api/auth/login {"email":"ops@northwind.com","password":"…"}
200 {"user":{"id":"531a7974-…","name":"Northwind Ops","email":"ops@northwind.com","role":"client"}}
Set-Cookie: rl_session=<64 hex>; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax

GET /api/auth/me
200 {"user":{…,"role":"client"},"workspaces":[{"clientId":"2ea171a2-…","name":"Northwind Labs","status":"active"}]}
```

## Step 2: the same user asks for Greenleaf

```
GET /api/clients/<Greenleaf id>   404 {"error":"NOT_FOUND","message":"Not found"}
GET /api/clients/<Northwind id>   200 {"clientId":"2ea171a2-…","name":"Northwind Labs","status":"active"}
```

## Step 3: staff see only assigned clients

```
GET /api/auth/me (meera@reaplift.com)
200 {"user":{…,"role":"staff"},"workspaces":[{"name":"Bluebird Retail",…},{"name":"Northwind Labs",…}]}
GET /api/clients/<Bluebird id>    200
GET /api/clients/<Greenleaf id>   404 {"error":"NOT_FOUND","message":"Not found"}
```

## Step 4: the super admin sees every client and the admin routes

```
GET /api/auth/me (ravi@reaplift.com)   200, workspaces: Bluebird Retail, Greenleaf Foods, Northwind Labs
GET /api/admin/clients (super admin)   200
GET /api/admin/clients (client user)   403 {"error":"FORBIDDEN","message":"Only a super admin can do this"}
```

## Step 5: lockout

```
POST /api/auth/login sales@greenleaf.in, wrong password ×10   401 each
POST /api/auth/login sales@greenleaf.in, right password
423 {"error":"LOGIN_LOCKED","message":"Too many failed logins; try again later","lockedUntil":"2026-10-30T05:35:26.274Z"}
```

## Origin check

```
POST /api/auth/login with Origin: https://evil.example
403 {"error":"FORBIDDEN","message":"Request origin not allowed"}
```

## Step 6: restart, then logout

```
(server stopped: /healthz unreachable; server started again)
GET /api/auth/me with the earlier cookie    200
POST /api/auth/logout                       204, Set-Cookie: rl_session=; Max-Age=0
GET /api/auth/me with the old cookie        401 {"error":"UNAUTHENTICATED","message":"Please log in"}
```

## Operator command

```
cli create-user --email Asha@Northwind.com --name Asha --role client --client "Northwind Labs"   Created (stored lower-case)
cli create-user … --role client (no --client)      Error: a client user needs a client
cli create-user … same email again                 Error: asha@northwind.com already has a login
cli create-user … password "short"                 Error: password must be at least 10 characters
select left(password_hash, 10) from users          $argon2id$ for every row
```
