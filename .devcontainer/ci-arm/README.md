# Positron CI dev container (ubuntu24-arm64)

Develop, debug, and run Positron **inside the actual CI image**
(`ghcr.io/posit-dev/positron-ubuntu24-arm64`) so CI failures reproduce locally. You edit code
natively in VS Code; the build, the tests, and Positron itself all run in the container.

> Validated on **arm64** (Apple Silicon) only. The arch is parameterized and amd64 images exist
> (CI uses them), but amd64 and Windows aren't validated yet.

## Prerequisites

1. **Docker Desktop**, with enough resources: **8+ CPU, 16 GB RAM**, and a few GB of free disk
   (image + `node_modules` + build). `Settings → Resources → Advanced`; turn on **VirtioFS** for the
   best bind-mount performance.
2. **GHCR login** (the images are private):
   ```bash
   docker login ghcr.io -u <your_github_username>   # password = a GitHub PAT with read:packages
   ```
3. Install the following extensions:
	* **`Dev Containers`**, required, using **VS Code** as the client
	* **`Task Buttons`**, optional, but highly recommended so you don't have to dig through Task menus

## Setup

One-time, on the host.

### 1. Create your `.env`

Copy the template, then fill in the Postgres connection info from 1Password (`E2E Postgres DB connection info`):

```bash
cp .devcontainer/ci-arm/.env.example .devcontainer/ci-arm/.env
```

### 2. Add your license

Copy the `Positron Server private key` from 1Password to:

```
.devcontainer/ci-arm/license.txt
```

Both `.env` and `license.txt` are gitignored — don't commit them.

### 3. Open the workspace in the container

From a regular clone or a git worktree of Positron, run `Dev Containers: Open Workspace in
Container…` → `positron-ci.code-workspace` → `Positron CI (ubuntu24-arm64)`.

The **first open runs the cold build** (`post-create.sh`: `npm ci`, compile, Electron, Playwright) —
about 10 minutes, once per machine. The build persists on Docker volumes, so later opens are fast.
`post-start.sh` then starts Xvfb, VNC, and the Doctor, and you're ready to develop.

(Worktrees work too, but must be a **full clone** — see [How storage works](#how-storage-works).)

## How to

Install the **Task Buttons** extension and the common actions sit in the status bar — one click, no
Command Palette. Everything else is under `Cmd-Shift-P → Tasks: Run Task` (type "Positron CI" to
filter); debug profiles are in the **Run and Debug** panel.

**Start the Doctor and keep it open** (Doctor button or task): a live dashboard of build status,
services, and URLs that refreshes within a few seconds when anything changes. `q` quits.

### Edit and re-run

Editing recompiles in seconds, never the ~10-min cold build:

1. Start the **Watch** task once. It recompiles changed files on save.
2. Edit code natively against your host checkout.
3. Re-run or re-debug. Only `npm ci`-level changes need a rebuild — see
   [When do I need to rebuild?](#when-do-i-need-to-rebuild).

### Run tests

Click the ▶ in the gutter on any spec (if it's missing, check the selected Playwright project), or
from the terminal: `npx playwright test --project e2e-electron --grep @:search`.

Headed runs (`e2e-electron`/`e2e-chromium`) render on the headless display — open the noVNC link in
the Doctor to watch live.

### Test files (qa-example-content)

The e2e tests open files from [qa-example-content](https://github.com/posit-dev/qa-example-content);
the framework clones it on first run. To grab it up front for manual repro, run **Positron CI: Get QA
content** — it lands at the test path and is symlinked to `~/qa-example-content`. Test teardown
git-resets the copy, so don't keep edits there.

### Debug

To debug **Positron's own source**, open the **Run and Debug** panel (`Cmd-Shift-D`), pick a profile,
and hit ▶. Set breakpoints in `src/` as usual; both profiles run on the headless display, so watch
in VNC.

- **Positron CI: Debug (Electron)** — the desktop app; attaches to all its processes (main, renderer,
  extension host, …). The simpler choice for most source.
- **Positron CI: Debug (Web)** — the browser build; brings up the licensed server (`:8080`) and debugs
  the workbench frontend in Chromium. Use it for web-only or `e2e-chromium` behavior.

Debug **e2e tests** straight from the test files via the gutter run/debug icons, not a launch profile.

### Run Positron itself

- **Positron CI: Start server** — a licensed server at `http://localhost:8080/?tkn=dev-token` (browser).
- **Positron CI: Desktop** — the desktop app on the headless display; watch via VNC.

Both run detached (logs in `/tmp/positron-{server,electron}.log`) and restart cleanly on re-click;
their URLs show in the Doctor. **Stop** shuts both (plus the report) down and leaves core services up.

### When do I need to rebuild?

You don't have to guess — the Doctor checks deps and build state and names the task:

- deps changed → **Reinstall deps** / **Reinstall e2e deps**
- no compiled output → start **Watch (src)**
- build incomplete → **Rebuild**

## Reference

### How storage works

Your **checkout** is a bind mount, so edits live on your host disk and file navigation works
normally. The heavy **container-built dirs** live on Docker volumes instead: native volume I/O beats
macOS bind mounts, and it keeps Linux-built binaries out of your host checkout. There are four,
prefixed with the Compose project (e.g. `ci-arm_`; list them with `docker volume ls` or `reset.sh`):

| Volume | Holds |
|---|---|
| `positron-node-modules` | root `node_modules` (the big one) |
| `positron-e2e-node-modules` | `test/e2e/node_modules` (separate npm project; small) |
| `positron-build` | `.build/` (built Electron + artifacts) |
| `postgres-data` | the postgres sidecar's database files |

`out/` is the exception: it stays on the bind mount, since the compile recreates it.

**Worktrees** just work — a host-side `initializeCommand` auto-detects your checkout and git dir and
mounts both. It must be a **full clone**, though: a shallow clone can't build, because the compile
needs git history.

### Tasks

| Task | What it does |
|---|---|
| **Positron CI: Start server** | licenses and serves Positron at `:8080` (detached, clean restart, prints the URL when up) |
| **Positron CI: Desktop** | runs the desktop app on the headless display, watch via VNC (detached, clean restart) |
| **Positron CI: VNC** | ensures VNC is up; prints `vnc://localhost:5900` and the password |
| **Positron CI: Report** | serves the last run's trace/report at `:9323` |
| **Positron CI: Stop** | stops the on-demand server/desktop/report (leaves Xvfb/VNC/noVNC/postgres up) |
| **Positron CI: Doctor** | live dashboard — build status + what's up (Xvfb/VNC/noVNC/postgres, server/desktop/report); updates when state changes, any key refreshes, `q` quits |
| **Positron CI: Reinstall deps** | after the root `package-lock.json` changes; records only the root hash |
| **Positron CI: Reinstall e2e deps** | after `test/e2e/package-lock.json` changes; records only the e2e hash |
| **Positron CI: Rebuild** | re-runs the whole cold build (idempotent) |
| **Positron CI: Get QA content** | fetch/refresh qa-example-content (test files) for manual repro; linked at `~/qa-example-content` |
| **Positron CI: Watch (src)** | incremental compiler for the edit-debug loop; reload the window after "Finished compilation" |
| *Run and Debug →* **Positron CI: Debug (Electron)** / **(Web)** | debug Positron source — desktop app / browser build (see Debug above) |

### Updating the image tag

When CI bumps the image, update `POSITRON_CI_IMAGE_TAG` (the default in `docker-compose.yml`, or in
your `.env`). A tag change needs **Dev Containers: Rebuild Container**; a changed `.env` alone won't
trigger a rebuild.

### Start over (reset)

To force a fresh cold build - e.g. to verify the whole flow end to end - close the container
(**Dev Containers: Reopen Folder Locally**), then run on the host:

```bash
./.devcontainer/ci-arm/reset.sh        # shows what it'll remove and prompts; add -y to skip
```

It removes this project's dev container, its data volumes (root + e2e `node_modules`, `.build`,
`postgres-data`) and the compiled `out/`, scoped to this checkout's Compose project. Your source,
`.env`, and `license.txt` are left alone. Then **Reopen in Container** for the clean build.

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
- **The Ports panel fills up** (30-40 entries). Positron auto-forwards many internal `127.0.0.1`
  ports (extension hosts, language servers, kernels); only the four labeled ones
  (8080/9323/6080/5900) matter. Run **Remote: Close Unused Ports** to declutter. (Suppressing the
  auto-forward via settings doesn't stick in a connected container.)
- **After editing test-infra files** (`test/e2e/infra/…`), run **Developer: Reload Window** so the
  Playwright extension picks them up (it caches transpiles in a worker).
