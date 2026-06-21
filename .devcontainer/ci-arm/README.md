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
   * **Dev Containers extension**, using **VS Code** as the client
	 * **Task Buttons**, optional but highly recommended so you don't have to dig through Task menus

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

From a regular clone or a git worktree of Positron, run **Dev Containers: Open Workspace in
Container…** → pick `positron-ci.code-workspace` → choose **Positron CI (ubuntu24-arm64)**.


The **first open runs the cold build** (`post-create.sh`: `npm ci`, compile, Electron, Playwright),
about 10 minutes once per machine. It persists on Docker volumes, so later opens are fast.
`post-start.sh` then starts Xvfb, VNC, and runs the doctor.

Worth knowing about the setup:

- Your checkout is a **bind mount**, so edits live on your host disk and file navigation works
  normally.
- The heavy container-built dirs live on **Docker volumes** instead of the bind mount — native
  volume I/O is much faster than macOS bind mounts, and it keeps Linux-built binaries out of your
  host checkout. Four volumes (shown by `reset.sh` / `docker volume ls`, prefixed with the Compose
  project, e.g. `ci-arm_`):
  - `positron-node-modules` — root `node_modules` (the big one)
  - `positron-e2e-node-modules` — `test/e2e/node_modules` (separate npm project; small)
  - `positron-build` — `.build/` (the built Electron + artifacts)
  - `postgres-data` — the postgres sidecar's database files
  `out/` is the exception: it stays on the bind mount (the compile recreates it).
- **Worktrees just work.** A host-side `initializeCommand` auto-detects your checkout and git dir
  and mounts both. It must be a **full clone**, though: a shallow clone can't build, because the
  compile needs git history.

## How to

If you install the button tasks extension, the most common actions are at the bottom of the window: one click, no Command Palette. Everything else is in `Cmd-Shift-P → Tasks: Run Task`, prefixed `Positron CI:` (type "Positron CI" to filter). The debugger lives in the **Run and Debug** panel also prefxied with `Positron: CI`.

**Start the Doctor and keep it open** (click the **Doctor** button, or run the task).
It's a live dashboard (build status, services, URLs) that refreshes itself within a few seconds
whenever something changes; `q` quits.

### Edit and re-run

The everyday cycle. The key point: editing recompiles in seconds, never the ~10-min cold build.

1. Start the build watcher **once**: `npm run watch` or `Watch` task button. It recompiles changed files on save, in seconds.
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

**Watching a headed run:** `e2e-electron`/`e2e-chromium` render on the headless display. Open the
noVNC link in the Doctor to watch live; no need to launch the Desktop first.

### Test files (qa-example-content)

Tests open files from [qa-example-content](https://github.com/posit-dev/qa-example-content)
(notebooks, data, sample projects); the framework clones it on first run. To grab it up front for
manual repro, run **Positron CI: Get QA content**. The real copy lands at the test path
(`/tmp/vscsmoke/qa-example-content`) and is symlinked to `~/qa-example-content` for easy opening;
re-run any time to refresh. The Doctor shows when it was last fetched. Test teardown git-resets the
copy, so don't keep edits there.

### Debug

Two profiles for debugging **Positron's own source** — open the **Run and Debug** panel
(`Cmd-Shift-D`), pick one, and hit ▶ (or `fn-F5`). Set breakpoints in `src/` as usual; they bind via
source maps. Both launch Positron on the headless display, so watch it in VNC (below).

- **Positron CI: Debug (Electron)** — the desktop app. Launches Positron and attaches to all of its
  processes (main, renderer, extension host, …), so breakpoints anywhere in `src/` bind.
- **Positron CI: Debug (Web)** — the browser build. Brings up the licensed server (`:8080`) and
  debugs the workbench frontend in Chromium (viewable in VNC). Use it for web-only behavior or
  `e2e-chromium` scenarios; for most source, Electron is simpler.

**e2e tests** are debugged straight from the test files — click the Playwright run/debug icons in the
editor gutter (or Test Explorer), not a launch profile.

### Run Positron itself

- **Browser server:** **Positron CI: Start server** serves a licensed Positron at
  `http://localhost:8080/?tkn=dev-token` (browser only, not VNC).
- **Desktop app:** **Positron CI: Desktop** renders on the headless display; watch it via VNC.

Both run detached (logs in `/tmp/positron-server.log` and `/tmp/positron-electron.log`) and restart
cleanly if you re-click; their URLs show in the Doctor a few seconds after they come up. **Stop**
shuts down the server, desktop, and report together and leaves the core services up.

### When do I need to rebuild?

You don't have to guess. The Doctor compares `package-lock.json` against the last install, checks
the build, and names the task to run:

- deps changed → **Reinstall deps** / **Reinstall e2e deps**
- no compiled output → start **Watch (src)**
- build incomplete → **Rebuild**

## Reference

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
