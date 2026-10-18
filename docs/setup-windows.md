# Setup on Windows

Steps for Windows 10 or 11. Run commands in **PowerShell** or the VS Code terminal (PowerShell is its default on Windows).

## 1. Install the tools (once)

Open **PowerShell as Administrator** (Start menu > type PowerShell > right-click > Run as administrator) and run:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e
winget install --id Microsoft.VisualStudioCode -e
```

If `winget` is not found, install **App Installer** from the Microsoft Store, or download each tool from its website (git-scm.com, nodejs.org (LTS, version 22 or newer), docker.com, code.visualstudio.com).

Then, still in the Administrator PowerShell:

```powershell
corepack enable
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
git config --global core.autocrlf false
```

- `corepack enable` installs **pnpm**. It needs the Administrator window.
- The execution policy lets PowerShell run `pnpm`.
- `core.autocrlf false` keeps line endings as they are in the repo, so files do not show as changed.

**Docker Desktop:** open it once. If it asks to install or update **WSL 2**, accept and restart Windows. Wait until it says "Engine running".

Close the Administrator window and open a normal PowerShell. Check everything:

```powershell
git --version
node -v          # v22 or newer
pnpm -v          # 10.x
docker -v
```

## 1.5 Turn on the repo review hook (required for pushes)

After cloning the repo, run this once:

```powershell
git config core.hooksPath .githooks
Set-ExecutionPolicy -Scope Process Bypass
chmod +x .githooks/pre-push
```

This makes every `git push` run the repo review gate before anything goes to GitHub. The hook calls `pnpm review:prepush` and blocks a push if the branch is behind `main`, the code fails lint/typecheck/tests, or the project is not ready for review.

## 2. Get the code (once)

1. Open VS Code, press **Ctrl+Shift+P**, choose **Git: Clone**, paste `https://github.com/reaplift/reaplift-bsp`, pick a folder (for example `C:\Code`), and click **Open**.
2. Sign in to GitHub when VS Code asks.
3. When VS Code offers the recommended extensions, click **Install All**.

Keep the folder path short and without spaces (`C:\Code\reaplift-bsp` is good; avoid OneDrive folders, which slow down `node_modules`).

Or from PowerShell:

```powershell
mkdir C:\Code; cd C:\Code
git clone https://github.com/reaplift/reaplift-bsp.git
cd reaplift-bsp
code .
```

## 3. First run

Open the VS Code terminal with **Ctrl+`** (backtick) and run:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:up                             # Docker Desktop must be running
pnpm migrate
pnpm --filter @reaplift/shared build
pnpm dev
```

Open http://localhost:5173 in your browser. It should say **API: ok (version dev, database ok)**.

Stop the app with **Ctrl+C**. Stop the database with `pnpm db:down`.

## 4. Every day after that

```powershell
git checkout main; git pull          # get the latest code
pnpm install                         # only if packages changed
pnpm db:up; pnpm migrate             # start the database, apply new migrations
pnpm dev
```

## Problems

| You see                                      | Fix                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm : The term 'pnpm' is not recognized`   | Run `corepack enable` in an Administrator PowerShell, then reopen VS Code |
| `running scripts is disabled on this system` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`                     |
| `error during connect` / Docker not running  | Open Docker Desktop and wait for "Engine running"                         |
| Docker asks for WSL                          | Run `wsl --install` in an Administrator PowerShell, restart Windows       |
| `port 5432 is already allocated`             | A PostgreSQL service is installed: Services app > postgresql > Stop       |
| `port 3000` or `5173` in use                 | `netstat -ano \| findstr :3000`, then end that process in Task Manager    |
| Every file shows as changed in Git           | `git config --global core.autocrlf false`, then `git checkout -- .`       |
| `EPERM` or very slow `pnpm install`          | Move the folder out of OneDrive, e.g. to `C:\Code`                        |
