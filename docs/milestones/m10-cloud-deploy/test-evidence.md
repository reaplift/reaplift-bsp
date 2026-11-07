# M10 test evidence

## 10.1 Container image and production compose

Run on 6 November 2026, on a Windows laptop with Docker Desktop (Compose v5.6.1). No server yet (E4), so this is the image and the compose file only.

### What was built

- `Dockerfile` (from M0, multi-stage, `node:22-slim`): now takes `APP_VERSION` as a build argument and sets it, so `/healthz` reports the commit; sets `UPLOAD_DIR=/app/uploads` and creates that folder owned by `node`, so a volume mounted there is writable.
- `infra/compose.prod.yml`: `postgres` (no ports), a one-shot `migrate`, then `api`, `receiver`, `worker` and `scheduler` from the same image with `MODE` set per service. `api` is bound to `127.0.0.1` only (Caddy is the way in, 10.3) and has a health check; every service restarts unless stopped; logs are capped at 5 × 20 MB. `REAPLIFT_VERSION` is both the image tag and the version `/healthz` reports, and it overrides any `APP_VERSION` in `.env`.
- `ci.yml`, job `image starts and answers /healthz`: builds the image tagged with the commit, starts the production compose, waits up to 60 seconds for `/healthz` to report that commit with `db: ok`, checks `migrate` exited 0 and the four services are running, prints the logs, and stops it.
- `.env.example`: `POSTGRES_PASSWORD`, `REAPLIFT_IMAGE`, `REAPLIFT_VERSION`, `API_PORT`, blank.

### Run it

```bash
docker build --build-arg APP_VERSION=<commit> -t reaplift-bsp:<commit> .
grep -v '^POSTGRES_PASSWORD=' .env.example > infra/.env
echo "POSTGRES_PASSWORD=<something>" >> infra/.env
REAPLIFT_VERSION=<commit> docker compose -f infra/compose.prod.yml up -d
curl http://127.0.0.1:3000/healthz
REAPLIFT_VERSION=<commit> docker compose -f infra/compose.prod.yml down -v
```

Port 3000 was taken on this laptop, so the runs below used `API_PORT=3200`.

### Results

The image (`28074bf-local`), inside: `APP_VERSION=28074bf-local UPLOAD_DIR=/app/uploads`, `/app/uploads` owned by `node`, the process runs as `node`, the built panel is in `/app/public`.

First start:

```text
api health: healthy
healthz: {"status":"ok","version":"28074bf-local","db":"ok"}
SERVICE     STATE     STATUS                     PORTS
api         running   Up 6 seconds (healthy)     127.0.0.1:3200->3000/tcp
migrate     exited    Exited (0) 7 seconds ago
postgres    running   Up 11 seconds (healthy)    5432/tcp
receiver    running   Up 6 seconds               3000/tcp
scheduler   running   Up 6 seconds               3000/tcp
worker      running   Up 6 seconds               3000/tcp
```

Logs: migrate `migrations finished` with all 17 applied; `api listening`; `receiver started`; `worker started`; `scheduler started` and `ledger check clean`. No line at error level. `api` and `worker` can both write to the shared uploads volume. The api listens on `127.0.0.1:3200` only; postgres publishes no port.

**Restart:** a row added to `clients`, then `down` and `up` (volumes kept): migrate `"applied":[]`, `/healthz` ok, the row still there.

**ARM64:** `docker buildx build --platform linux/arm64` built the image (`arm64 linux`). The same stack switched to it by changing only `REAPLIFT_VERSION` (as a deploy will): all four services on `reaplift-bsp:28074bf-arm64`, `/healthz` `{"status":"ok","version":"28074bf-arm64","db":"ok"}`, the row still there. This ran under emulation on the laptop, not on an Ampere server.

**The CI steps**, run locally with the same commands on a fresh stack: one empty reply while the api started, then `{"status":"ok","version":"28074bf-local","db":"ok"}`; migrate exit 0; the four services running. The same check with a different expected version fails, as it should. `prettier --check` passes on `ci.yml` and `compose.prod.yml`.

Not proved here: the CI job itself on GitHub (it runs on the next push), and the image on a real ARM server (10.2, E4).
