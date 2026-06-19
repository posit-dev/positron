# Positron CI dev container (ubuntu24-arm64)

Develop, debug, and run Positron **inside the actual CI image**
(`ghcr.io/posit-dev/positron-ubuntu24-arm64`) so CI failures reproduce locally. You edit code
natively in VS Code; the build, the tests, and Positron itself all run in the container.

> Validated on **arm64** (Apple Silicon) only. The arch is parameterized and amd64 images exist
> (CI uses them), but amd64 and Windows aren't validated yet.

## Prerequisites

1. **Docker Desktop**, with enough resources: **8+ CPU, 16 GB RAM**, and a few GB of free disk
   (image + `node_modules` + build). Settings → Resources → Advanced; turn on **VirtioFS** for the
   best bind-mount performance.
2. **GHCR login** (the images are private):
   ```bash
   docker login ghcr.io -u <your_github_username>   # password = a GitHub PAT with read:packages
   ```
3. **Dev Containers extension**, using **VS Code** as the client

## Setup

One-time, on the host.

### 1. Create your `.env`

```bash
cp .devcontainer/ci-arm/.env.example .devcontainer/ci-arm/.env
```

| Setting | Where |
|---|---|
| `E2E_POSTGRES_USER` / `E2E_POSTGRES_PASSWORD` | 1Password → *Positron > E2E Postgres DB Connection info* |
| `POSITRON_CI_IMAGE_TAG` | defaults to the current CI tag (`127`); override to pin a specific CI run |
| `POSITRON_CI_IMAGE_ARCH` | `arm64` (default, validated) |

### 2. Add your license

The dev license is a multi-line PEM key (1Password → IDE/Workbench vault) that a `.env` can't hold,
so save the whole `-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----` block to:

```
.devcontainer/ci-arm/license.txt
```

`post-create.sh` installs it as the `pdol_rsa` signing key. The e2e-electron tests use that key
directly; the browser server needs a *generated* key, which the "Start server" task issues for you.
Both `.env` and `license.txt` are gitignored.

### 3. Open the workspace in the container

Open your Positron checkout (a regular clone or a git worktree), then:

1. **File → Open Workspace from File…** → `positron-ci.code-workspace`
2. **Dev Containers: Reopen in Container** → **Positron CI (ubuntu24-arm64)**
3. When prompted to install the recommended **Task Buttons** extension, click **Install**. That's
   what draws the status-bar buttons.

The **first open runs the cold build** (`post-create.sh`: `npm ci`, compile, Electron, Playwright),
about 10 minutes once per machine. It persists on Docker volumes, so later opens are fast.
`post-start.sh` then starts Xvfb, VNC, and runs the doctor.

Worth knowing about the setup:

- Your checkout is a **bind mount**, so edits live on your host disk and file navigation works
  normally.
- `node_modules`, `test/e2e/node_modules`, and `.build` live on fast Docker volumes; `out/` is on
  the bind mount (the compile recreates it).
- **Worktrees just work.** A host-side `initializeCommand` auto-detects your checkout and git dir
  and mounts both. It must be a **full clone**, though: a shallow clone can't build, because the
  compile needs git history.
- Opening `positron-ci.code-workspace` (rather than the plain folder) is what surfaces the CI tasks,
  the debug config, and the buttons. Someone who opens the repo normally sees none of it.

## How to

The common actions (**Server (Web)**, **Desktop (Electron)**, **Report**, **Stop**, **Doctor**) are
**status-bar buttons** at the bottom of the window: one click, no Command Palette. Everything else is
in `Cmd-Shift-P → Tasks: Run Task`, prefixed **`Positron CI:`** (type "Positron CI" to filter). The
debugger lives in the **Run and Debug** panel.

A note on terminals: the quick actions (Server, Desktop, VNC) share **one rolling terminal** — each
click clears it and shows that action's receipt (the clickable URL), so nothing piles up. **Stop**
runs silently with no terminal — the Doctor reflects it within a few seconds. The **Doctor** opens a
**live dashboard** in its own terminal that **updates on its own when something changes** (within a
few seconds — so clicking Server or Stop shows up there without you doing anything), stays still when
nothing's happening, and any key forces a refresh (`q` quits). Keep it open in a split and it's your
at-a-glance status board.

### Edit and re-run

The everyday cycle. The key point: editing recompiles in seconds, never the ~10-min cold build.

1. Start the build watcher **once**: `npm run watch` in the terminal (or the native **Positron -
   Build** task). It recompiles changed files on save, in seconds.
2. Edit code in VS Code. It's native editing against your host checkout.
3. Re-run or re-debug. Only `npm ci`-level changes need a rebuild (see
   [When do I need to rebuild?](#when-do-i-need-to-rebuild)).

### Run tests

- **Spec files:** browse to any test and click the ▶ in the gutter. If no play button shows, check
  that the correct Playwright project is selected.
- **Terminal:** `npx playwright test --project e2e-electron --grep @:search`

| Project | What it does | Need to start anything? |
|---|---|---|
| `e2e-electron` | self-launches the desktop app (headless) | no — the main CI-repro path |
| `e2e-chromium` | self-starts a web server, runs headed in Chromium (watch via VNC) | no — works out of the box |
| `e2e-server` | connects to an **external** server | yes — run **Positron CI: Start server** first |

### Test files (qa-example-content)

Many tests open files from [qa-example-content](https://github.com/posit-dev/qa-example-content) —
notebooks, data files, sample projects. The framework clones it for you on the first test run, to
`/tmp/vscsmoke/qa-example-content` (cached at `/tmp/qa-example-content-cache`). To grab it *without*
running a test first — handy for manually reproducing what a test does — run **Positron CI: Get QA
content**; re-run it any time to refresh to the latest (it doesn't auto-update). The Doctor shows
whether it's present and how long ago it was fetched. Note: test teardown git-resets that copy, so
don't keep edits there.

### Debug

- **Run and Debug** panel (`Cmd-Shift-D`) → **Positron CI: Debug (electron)** → green ▶ (or
  `fn-F5`).
- To watch the app the test drives, open VNC (below); the Electron window shows up there.

### Run Positron itself

Two ways to run Positron, a **browser server** and the **desktop app**, plus VNC for watching
anything headed. Both print a **clickable URL once they're actually up**, and both do a **clean
restart** if you click again.

- **Browser:** **Positron CI: Start server** issues a license, waits for the port, then prints
  `http://localhost:8080/?tkn=dev-token`. Cmd-click it. Runs detached (logs at
  `/tmp/positron-server.log`). This is a headless web server, so it does *not* appear in VNC; it's
  browser-only.
- **Desktop app:** **Positron CI: Desktop** renders on the headless display, then
  prints the noVNC URL below. Runs detached (logs at `/tmp/positron-electron.log`).
- **Watch in your browser (VNC):** Cmd-click
  `http://localhost:6080/vnc.html?autoconnect=true&password=positron`. It opens noVNC in a tab and
  auto-connects, with no app or password prompt. The desktop app and any headed
  `e2e-chromium`/`e2e-firefox` browser appear here (fluxbox window manager, so windows are movable).
  **Positron CI: VNC** re-prints the URL. Prefer a native viewer? Use
  `vnc://localhost:5900`, password `positron`.
- **Inspect a finished run:** **Positron CI: Report** → `http://localhost:9323`.
  The trace viewer gives a frame-by-frame timeline with screenshots and DOM snapshots, usually more
  useful than watching a fast run live.

You can run the **server and the desktop at the same time**. They're independent (separate
user-data-dirs, processes, and ports): the server shows only in your browser (`:8080`), the desktop
only in VNC (`:6080`). Re-clicking either restarts it cleanly without disturbing the other.

**Stopping things.** The server and desktop run *detached* (that's what keeps them alive after the
task finishes), so there's no terminal to Ctrl-C. To clean up, use the **Stop** button (or
**Positron CI: Stop**) — it stops the server, desktop, and report in one go and leaves the
core services (Xvfb, VNC, postgres) up. It runs silently (no terminal); the **Doctor** reflects it
within a few seconds and shows what's running (with a stop hint when anything is).

### Reproduce a CI failure

1. Check out the failing branch in the container terminal.
2. If `package-lock.json` changed, the doctor flags it on start → **Positron CI: Reinstall
   deps (npm ci)**.
3. Run the same project and grep CI used (e.g. `--project e2e-electron --grep <name of test>`).
   Watch via VNC or read the trace, and debug with breakpoints. Same image, same DB, same env as CI.

### When do I need to rebuild?

You don't have to guess. The **doctor** runs on every container start, and on demand via
**Positron CI: Doctor**. It compares `package-lock.json` against the last install and
checks for compiled output, Electron, and a completed build, then names the task to run:

- deps changed → **Positron CI: Reinstall deps**
- no compiled output → start the watcher (`npm run watch`)
- build incomplete → **Positron CI: Rebuild**

A clean checkout with the watcher running needs nothing. The same doctor also reports a quick health
overview — which **services** are up (Xvfb, VNC, postgres) and what's currently **running** (server,
desktop, report) — so it doubles as a "is everything OK?" check.

## Reference

### Tasks

| Task | What it does |
|---|---|
| **Positron CI: Start server** | licenses and serves Positron at `:8080` (detached, clean restart, prints the URL when up) |
| **Positron CI: Desktop** | runs the desktop app on the headless display, watch via VNC (detached, clean restart) |
| **Positron CI: VNC** | ensures VNC is up; prints `vnc://localhost:5900` and the password |
| **Positron CI: Report** | serves the last run's trace/report at `:9323` |
| **Positron CI: Stop** | stops the on-demand server/desktop/report (leaves Xvfb/VNC/postgres up) |
| **Positron CI: Doctor** | live dashboard — build status + what's up (Xvfb/VNC/postgres, server/desktop/report); updates when state changes, any key refreshes, `q` quits |
| **Positron CI: Reinstall deps** | after deps change; refreshes the doctor's state |
| **Positron CI: Rebuild** | re-runs the whole cold build (idempotent) |
| **Positron CI: Get QA content** | fetch/refresh qa-example-content (test files) to `/tmp/vscsmoke` for manual repro |
| *Run and Debug →* **Positron CI: Debug (electron)** | runs e2e-electron under the debugger |

### Logs

Server → `/tmp/positron-server.log` · Desktop → `/tmp/positron-electron.log`.

### Updating the image tag

When CI bumps the image, update `POSITRON_CI_IMAGE_TAG` (the default in `docker-compose.yml`, or in
your `.env`). A tag change needs **Dev Containers: Rebuild Container**; a changed `.env` alone won't
trigger a rebuild.

### Gotchas

- **Blank/white VNC window** means a stuck Electron instance. The Launch task auto-clears it now, so
  just re-launch. If it persists, the build may not be ready (run the Doctor) or check the desktop
  log.
- **`npm ci` may leave files staged in your worktree.** Positron's postinstall runs
  `git add --renormalize`, which stages line-ending changes in your bind-mounted index. It's
  harmless: `git restore --staged .`.
- **`out/` lives on your host disk** (it can't be a volume, since the compile `rmdir`s it). If you
  also build natively on the same checkout, the two builds share `out/` and clobber each other;
  recompile after switching.
- **One dev container per checkout** at a time.
- **Only four ports are forwarded** (8080/9323/6080/5900). Positron opens many internal loopback
  ports; we ignore auto-forwarding so the Ports panel stays clean. Need another? Forward it manually
  from the **Ports** panel.
- **After editing test-infra files** (`test/e2e/infra/…`), run **Developer: Reload Window** so the
  Playwright extension picks them up (it caches transpiles in a worker).
