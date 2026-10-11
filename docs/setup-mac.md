# Setup on Mac

Steps for a Mac (Apple silicon or Intel). Run every command in the **Terminal** app or the VS Code terminal.

## 1. Install the tools (once)

1. **Homebrew** (package installer). Paste into Terminal and follow its prompts:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
   At the end it prints two `echo ... >> ~/.zprofile` lines. Run them, then close and reopen Terminal.
2. **Git and Node.js 22:**
   ```bash
   brew install git node@22
   brew link --overwrite --force node@22
   ```
3. **pnpm** (comes with Node through Corepack):
   ```bash
   corepack enable
   ```
4. **Docker Desktop:** download from https://www.docker.com/products/docker-desktop/ . Pick **Apple Silicon** (M1/M2/M3/M4) or **Intel** to match your Mac ( menu > About This Mac). Open it once and wait until it says "Engine running".
5. **VS Code:** download from https://code.visualstudio.com/ and drag it into Applications. Then in VS Code press Cmd+Shift+P, type `shell command`, and choose **Install 'code' command in PATH**.

Check everything:

```bash
git --version
node -v          # v22.x
pnpm -v          # 10.x
docker -v
```

## 2. Get the code (once)

1. In VS Code press **Cmd+Shift+P**, choose **Git: Clone**, paste `https://github.com/reaplift/reaplift-bsp`, pick a folder (for example `Documents/Code`), and click **Open**.
2. Sign in to GitHub when VS Code asks.
3. When VS Code offers the recommended extensions, click **Install All**.

Or from Terminal:

```bash
mkdir -p ~/Documents/Code && cd ~/Documents/Code
git clone https://github.com/reaplift/reaplift-bsp.git
cd reaplift-bsp
code .
```

## 3. First run

Open the VS Code terminal with **Ctrl+`** (backtick) and run:

```bash
pnpm install
cp .env.example .env
pnpm db:up                             # Docker Desktop must be running
pnpm migrate
pnpm --filter @reaplift/shared build
pnpm dev
```

Open http://localhost:5173 in your browser. It should say **API: ok (version dev, database ok)**.

Stop the app with **Ctrl+C**. Stop the database with `pnpm db:down`.

## 4. Every day after that

```bash
git checkout main && git pull         # get the latest code
pnpm install                          # only if packages changed
pnpm db:up && pnpm migrate            # start the database, apply new migrations
pnpm dev
```

## Problems

| You see                               | Fix                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `command not found: pnpm`             | Run `corepack enable`, then reopen the terminal                                     |
| `command not found: code`             | VS Code: Cmd+Shift+P > Install 'code' command in PATH                               |
| `Cannot connect to the Docker daemon` | Open Docker Desktop and wait for "Engine running"                                   |
| `port 5432 is already allocated`      | Another PostgreSQL is running: `brew services stop postgresql` or quit Postgres.app |
| `port 3000` or `5173` in use          | Close the other app, or find it with `lsof -i :3000`                                |
| `node -v` shows an old version        | `brew link --overwrite --force node@22`, then reopen the terminal                   |
