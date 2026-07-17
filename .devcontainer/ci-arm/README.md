# Positron CI dev container (ubuntu24-arm64)

Develop, debug, and run Positron **inside the actual CI image**
(`ghcr.io/posit-dev/positron-ubuntu24:24.15.0`) so CI failures reproduce locally. You edit code in VS Code on your host; the build, tests, and Positron itself run in the container.

> Validated on **arm64** (Apple Silicon) only. The base image is a multi-arch
> manifest, so Docker resolves the host arch automatically; `POSITRON_CI_IMAGE_ARCH`
> now only selects the in-container Electron build arch. amd64 hosts should work but
> aren't validated yet. Host: macOS with Docker Desktop + VirtioFS. Linux and
> Windows/WSL2 aren't validated yet.

<p align="center">
  <img src="doctor-and-task-buttons.png" width="600" alt="Terminal - Doctor View">
</p>

## Prerequisites

One-time setup:

1. Install and configure **Docker Desktop**, in `Settings`:
    * **Resources -> Advanced**: **8+ CPU**, **12 GB RAM**, a few GB free disk.
    * **General -> Virtual Machine Options**: turn on **VirtioFS**.
2. **GHCR login** (images are private):

   ```bash
   docker login ghcr.io -u <your_github_username>   # password = a GitHub PAT with read:packages
   ```

3. Install the **[Dev Containers](https://vscode.dev/redirect?url=vscode%3Aextension%2Fms-vscode-remote.remote-containers)**
   extension in **VS Code** (click the link to open straight to its install page) - it's what opens
   the container. The lab's own extensions (Task Buttons, Playwright, etc) install automatically
   inside the container.

## Setup

Do this once per machine -- the lab worktree is meant to be long-lived. Check `git worktree list`
first; if one already exists, reuse it ([User Workflows](#user-workflows-vs-code-ui) covers reopening)
instead of creating a second one, which silently shares rather than isolates build state with the
first (see the [Gotchas](#gotchas) entry on this).

### 1. Create the worktree

Create a dedicated git worktree for your CI lab so Linux build artifacts never mix with native builds (see [Don't mix container and native builds](#dont-mix-container-and-native-builds)). Start from a full Positron clone (not a shallow clone) because the build requires git history:

```bash
git worktree add ../positron-ci-lab
```

### 2. Add secrets - in the new worktree

These files are gitignored, so they aren't copied into the worktree. The container needs both:

* **.env** - first copy the example env file:

    ```
    cp .devcontainer/ci-arm/.env.example .devcontainer/ci-arm/.env
    ```

    Then insert the `E2E Postgres DB connection info` from 1Password.

* **license.txt** - the `Positron Server private key` from 1Password -> `.devcontainer/ci-arm/license.txt`.

### 3. Open it in the container

In VS Code, open the Command Palette and run **`Dev Containers: Open Workspace in Container...`**.
A file picker opens - select **`positron-ci-lab.code-workspace`** from the worktree directory.
A quick pick then appears - choose **`Positron CI (ubuntu24-arm64)`**.
The first open runs the ~10-min cold build; later opens are fast.

**After the first build, run `Developer: Reload Window` once** so the editor's TypeScript server and
Playwright extension pick up the freshly installed `node_modules` (one-time; later opens are clean).
Then open the **Doctor** (status-bar button) to confirm everything's up.

That's it - you have a working CI lab.

## Workflows

Two audiences, two subsections below: a human driving VS Code's Dev Containers UI, or an agent (e.g.
Claude Code) driving the same stack headlessly over `docker compose` / `docker exec`. Both need
[Setup](#setup) done first.

### User Workflows (VS Code UI)

| To... | Do this |
|---|---|
| reopen the lab | **Open Recent** the worktree, then **Reopen in Container** |
| done for the day | click **Stop** (stops services, prints disconnect instructions), then click the remote indicator → **Reopen Folder Locally** |
| return to local VS Code | run **Dev Containers: Reopen Folder Locally** |
| find where the lab lives | `git worktree list` prints its path (it's a directory, not a branch - `cd` into it) |
| run a common action | click a **Task Button** in the status bar |
| run any task | `Cmd-Shift-P` -> **Tasks: Run Task**, filter "Positron CI" |
| debug Positron's source | open **Run and Debug** (`Cmd-Shift-D`), pick a **Positron CI:** profile |

> [!IMPORTANT]
> Keep the **Doctor** open: a live dashboard of build/service status, ports, and URLs. If a check
> fails, it tells you which task fixes it.

#### Editing and the Watch task

The **Watch** task incrementally recompiles `src/` to `out/` on save. Start it when you're editing
Positron's source; you don't need it to run or test the existing build. Dependency changes (for example, a new package-lock.json) require Reinstall deps (or Reinstall e2e deps) or Rebuild instead; the **Doctor** flags this.

#### Run Positron itself
Click these task buttons to run Positron:
* **Server (Web)** - a licensed server at `http://localhost:8080/?tkn=dev-token` (browser).
* **Desktop (Electron)** - the desktop app on the headless display; view via VNC.

Both run detached and restart cleanly on re-click; their URLs show in the Doctor. Click **Logs** to
tail their output (`/tmp/positron-{server,electron}.log`, inside the container). **Stop** shuts both
down (and the report), leaving core services up.

#### Run tests

Click the run icon in the gutter on any spec (if it's missing, check the selected Playwright project), or
from the terminal: `npx playwright test --project e2e-electron --grep @:search`.

Headed runs (`e2e-electron` and `e2e-chromium`) render on the headless display. Open the noVNC link in the **Doctor** to view it live. Use the **Report** task to serve the report at any time.

#### Test data (test-files)

The e2e tests open files from `test/e2e/test-files` in the repo; the framework copies them into the
test workspace on first run. To grab them up front for manual repro, run **Positron CI: Get QA
content** - it's symlinked at `~/test-files`.

#### Debug

To debug **Positron's own source**, open the **Run and Debug** panel (`Cmd-Shift-D`), pick a profile,
and run it. Set breakpoints in `src/` as usual; both run on the headless display, so view in VNC.

* **Positron CI: Debug (Electron)** - the desktop app; attaches to all its processes (main, renderer,
  extension host, ...). Simplest for most source.
* **Positron CI: Debug (Web)** - the browser build; brings up the licensed server (`:8080`) and debugs
  the workbench frontend in Chromium. For web-only or `e2e-chromium` behavior.

Debug **e2e tests** straight from the test files via the gutter run/debug icons, not a launch profile.

### Claude Workflows (CLI-only, headless)

No Dev Containers UI -- drive the stack from the host with `docker compose`, once [Setup](#setup)'s
steps 1-2 are done (worktree created, secrets added). The build runs through this path too.

**Two commands:**

1. **Bring the lab up** (idempotent: initialize, compose up, build if cold, per-start setup):

   ```bash
   cd <worktree>/.devcontainer/ci-arm
   ./ci-lab-up.sh [<branch>]
   ```

   `ci-lab-up.sh` detects cold/warm/hot itself; with a `<branch>` it also checks out that branch and
   reconciles deps + `out/`. A cold build is ~10 min -- run it in the background; clean exit = ready.

2. **Run a spec** in the container (from the same `.devcontainer/ci-arm` dir, so Compose finds this
   project's `docker-compose.yml` and `.env`):

   ```bash
   docker compose exec -T test bash -lc \
     "cd \$POSITRON_WORKSPACE_PATH && ./.devcontainer/ci-arm/run-e2e.sh test/e2e/tests/<area>/<file>.test.ts --workers=1"
   ```

**Reproducing a CI-only flake? Run the *whole* spec at `--workers=1`** (as the command above does).
Positron doesn't split a single spec file across workers, so its tests run in order and share app
state. A test that only fails in CI often passes in isolation (a single `--grep`) yet fails because an
earlier test in the same file left state behind -- don't conclude "can't reproduce" from an isolated
run.

**How it works, and when it breaks.** `ci-lab-up.sh` chains `initialize.sh` -> `docker compose up -d`
-> cold-or-ready detection -> `post-create.sh` if cold (~10 min) -> the idempotent `post-start.sh`
(display, VNC, postgres). A `<branch>` argument also checks out that branch and reconciles deps +
`out/`. When a phase fails, read its log (`/tmp/post-create.log`, `/tmp/compile.log`) and the script's
`=== ci-lab-up: <phase> ===` echoes, then rerun that phase. Three non-obvious things it handles:

- **"Ready" checks artifacts, not just the marker.** Detection keys off `.build/.ci-arm-state/complete`
  *and* `out/main.js` + a populated `node_modules` -- a container can read built yet still fail a run
  with `Cannot find module`. That case is treated as cold; reinstall + recompile (or rerun
  `ci-lab-up.sh <branch>`).
- **No `containerEnv` over plain `docker compose`.** The four interpreter version selectors in
  `devcontainer.json`'s `containerEnv` are injected by the Dev Containers extension, not by
  `docker compose exec`, and the e2e suite throws without them. That's why runs go through
  `run-e2e.sh`, which reads the pins and exports them (plus `DISPLAY`, `--project e2e-electron`,
  `GITHUB_ACTIONS=true`, which is what makes image-comparison tests actually compare).
- **Branch switches stale deps and `out/`.** `out/` is bind-mounted and reflects whichever branch was
  last built here. Passing `<branch>` to `ci-lab-up.sh` reconciles both (sha-compare against
  `.build/.ci-arm-state/*.sha`, then `reinstall-deps.sh` / incremental compile as needed) -- prefer it
  over a bare `git checkout`.

## Reference

### Architecture

You **edit on your host**; **everything else runs in the container.** The desktop is headless - you view it (and any headed test) through noVNC in a browser. A postgres sidecar backs the e2e tests.

```mermaid
flowchart LR
    subgraph host["Host - your Mac (macOS)"]
        code["VS Code"]
        web["Browser"]
        src[/"Your checkout<br/>src, out/"/]
    end
    subgraph ctr["Container: positron-ubuntu24:24.15.0"]
        desk["Desktop app<br/>(Electron)"]
        srv["Web server<br/>:8080"]
        e2e["e2e tests"]
        nov["noVNC<br/>:6080"]
        xvnc["Xvnc<br/>display :10 / VNC :5900"]
        rep["Playwright<br/>report :9323"]
        vols[("Docker volumes<br/>node_modules, .build")]
    end
    pg[("postgres :5432<br/>sidecar")]

    code -->|edit| src
    src -. bind-mounted into .-> ctr
    desk --> xvnc
    e2e --> xvnc
    nov --> xvnc
    web -->|":6080 view<br/>desktop / e2e tests"| nov
    web -->|":8080 use"| srv
    web -->|":9323 view"| rep
    e2e -->|query| pg

    classDef hostcls fill:#dbe4ff,stroke:#4263eb,color:#0b1324
    classDef contcls fill:#fff3bf,stroke:#f08c00,color:#0b1324
    classDef storcls fill:#d3f9d8,stroke:#2f9e44,color:#0b1324
    class code,web hostcls
    class desk,srv,e2e,nov,xvnc,rep contcls
    class src hostcls
    class vols,pg storcls
```

Two ways to see Positron: **use** the web server at `:8080` in your browser, or **view** the
headless desktop (including any headed e2e test) over noVNC at `:6080`.

A window manager (fluxbox) keeps windows movable on the display. Forwarded to your host: `:8080`
(server), `:6080` (noVNC desktop), `:9323` (Playwright report), `:5900` (native VNC). The bind mount
vs Docker volume split is covered below.

### How storage works

Your **checkout** is a bind mount, so edits live on your host disk and file navigation works
normally. The heavy **container-built dirs** live on Docker volumes instead: native volume I/O performs much better than macOS bind mounts, and it keeps those big Linux-built dirs off your host disk. There are five, prefixed with the Compose project (e.g. `ci-arm_`; list them with `docker volume ls` or `reset.sh`):

| Volume | Holds |
|---|---|
| `positron-node-modules` | root `node_modules` (the big one) |
| `positron-e2e-node-modules` | `test/e2e/node_modules` (separate npm project; small) |
| `positron-remote-node-modules` | `remote/node_modules` (native server modules: spdlog, kerberos, node-pty) |
| `positron-build` | `.build/` (built Electron + artifacts) |
| `postgres-data` | the postgres sidecar's database files |

`out/` is the exception: it stays on the bind mount, since the compile recreates it.

Everything not listed above - your home dir, `/tmp`, and all logs (Positron's, the Xvnc desktop, the
detached server/desktop) - lives in the container's writable layer: container-only, not on your
host, and wiped on rebuild or `reset.sh`. Grab logs before rebuilding.

Your checkout is a **worktree** (from Setup), so a host-side `initializeCommand` mounts both it and
the shared git dir - that's what lets git resolve normally inside the container.

### Don't mix container and native builds

**One directory, one toolchain.** A few build artifacts (including three OS-specific binaries - `pet`,
`ark`, `kcserver`) live in the source tree, shared between host and container. Building the same checkout both in the container (Linux) and natively (macOS) causes them to overwrite each other, breaking interpreter and kernel startup. The dedicated worktree from [Setup](#setup) prevents this; if you're
already mixed, see [Gotchas](#gotchas) for the fix.

### Tasks

| Task | What it does |
|---|---|
| **Positron CI: Start server** | licenses and serves Positron at `:8080` (detached, clean restart, prints the URL when up) |
| **Positron CI: Desktop** | runs the desktop app on the headless display, view via VNC (detached, clean restart) |
| **Positron CI: VNC** | ensures VNC is up; prints `vnc://localhost:5900` and the password |
| **Positron CI: Report** | serves the last run's trace/report at `:9323` |
| **Positron CI: Logs** | tails the detached server + desktop logs in a terminal |
| **Positron CI: Stop** | stops the on-demand server/desktop/report (leaves Xvnc/noVNC/postgres up) |
| **Positron CI: Doctor** | live dashboard - build status + what's up (Xvnc/noVNC/postgres, server/desktop/report); updates when state changes, any key refreshes, `q` quits |
| **Positron CI: Reinstall deps** | after the root `package-lock.json` changes; records only the root hash |
| **Positron CI: Reinstall e2e deps** | after `test/e2e/package-lock.json` changes; records only the e2e hash |
| **Positron CI: Reinstall interpreters** | restore the Linux `pet`/`ark`/`kcserver` binaries after a native build clobbered them (Python/R fail to start; the Doctor flags it) |
| **Positron CI: Rebuild** | re-runs the whole cold build (idempotent) |
| **Positron CI: Get QA content** | provision test-files for manual repro; linked at `~/test-files` |
| **Positron CI: e2e (current spec)** | runs the open spec via `run-e2e.sh` (interpreter vars + `GITHUB_ACTIONS` set, whole file at `--workers=1`) - the CI-faithful path for reproducing flakes |
| **Positron CI: Watch (src)** | incremental compiler for the edit-debug loop; reload the window after "Finished compilation" |
| *Run and Debug ->* **Positron CI: Debug (Electron)** / **(Web)** | debug Positron source - desktop app / browser build (see Debug above) |

### When you're done

**Don't delete the container or volumes when you finish a session.** The lab is meant to be
long-lived, and the five Docker volumes ([node_modules, .build, postgres-data](#how-storage-works))
hold the expensive Linux-built state. Removing them forces a ~10-min cold rebuild next time; keeping
them means the next open is warm.

| Situation | What to do | What survives |
|---|---|---|
| **Done for the session** (UI) | click **Stop**, then the remote indicator -> **Reopen Folder Locally** (or just close the window). Docker stops the container; volumes persist. | everything -- next open is warm |
| **Done for the session** (headless) | nothing required; `docker compose stop` from `.devcontainer/ci-arm` if you want the container idle. `ci-lab-up.sh` is idempotent, so you can also just leave it. | everything |
| **Truly done / reclaim disk** | `npm run ci-lab-reset` -- the *only* time you remove containers + volumes (see [Start over](#start-over-reset) below). | source, `.env`, `license.txt` |

Avoid `docker volume rm`, `docker system prune`, or otherwise deleting the `ci-arm_*` volumes by
hand -- that nukes the warm build state the whole design exists to preserve. Use `reset.sh` /
`npm run ci-lab-reset` when you actually want a clean slate; it scopes the teardown to this checkout's
Compose project.

### Start over (reset)

To force a fresh cold build and reset the environment:
1. Close the container (**Dev Containers: Reopen Folder Locally**)
2. Then run on the host:

```bash
npm run ci-lab-reset                   # shows what it'll remove and prompts
# (or call the script directly: ./.devcontainer/ci-arm/reset.sh)
```

It removes this project's dev container, its data volumes (root + e2e + remote `node_modules`,
`.build`, `postgres-data`) and the compiled `out/`, scoped to this checkout's Compose project. Your source,
`.env`, and `license.txt` are left alone. Then **Reopen in Container** for the clean build.

### Gotchas

- **Blank/white VNC window** means a stuck Electron instance. The **Desktop** task auto-clears it
  now, so just re-launch it. If it persists, the build may not be ready (run the Doctor) or check the
  desktop log.
- **`npm ci` may leave files staged in your worktree.** Positron's postinstall runs
  `git add --renormalize`, which stages line-ending changes in your bind-mounted index. It's
  harmless: `git restore --staged .`.
- **Python/R interpreters dead after building one checkout both ways** - wrong-OS `pet`/`ark`/`kcserver`
  (see [Don't mix container and native builds](#dont-mix-container-and-native-builds)). The Doctor's
  **Interpreters** row flags this; run **Positron CI: Reinstall interpreters** to restore the Linux
  binaries.
- **Switching branches:** the source is bind-mounted, so a `git checkout` changes files under any
  running Watch/Positron/debug mid-session. Three ways to switch, cleanest first:
  - **Recommended -- switch before opening.** From local VS Code (**Reopen Folder Locally**),
    `git checkout` the target branch, then **Reopen in Container**. Nothing is running over the
    files as they change.
  - **Mid-session (messier).** `git checkout` in the open container, then reload the window and let
    **Watch** recompile (restart any running Positron/debug). Note Watch recompiles but does *not*
    check dependency drift -- rely on the Doctor's **Build** row to flag stale deps.
  - **Headless.** `ci-lab-up.sh <branch>` (see [Claude Workflows](#claude-workflows-cli-only-headless))
    does the same thing over the CLI, including the dependency-drift check Watch doesn't handle.

  Whichever path you take, keep the **Doctor** open: its Build and Interpreters rows tell you what
  went stale and which task fixes it.
- **Each checkout gets its own containers automatically -- but only once `initialize.sh` has run for
  it.** Compose's project name defaults to the directory *basename* holding `docker-compose.yml`,
  which is `ci-arm` for every checkout of this repo (they all have the same `.devcontainer/ci-arm`
  layout); without a fix, two checkouts would silently share one set of containers and volumes
  instead of erroring. `initialize.sh` (Setup step 3, and the first thing `ci-lab-up.sh` runs) closes this by pinning
  `COMPOSE_PROJECT_NAME` to the checkout's own directory name, so `docker compose up -d` always
  creates that checkout's own containers. The one sharp edge: a checkout whose `.env` predates this
  fix (no `COMPOSE_PROJECT_NAME` line) still defaults to the shared `ci-arm` name until
  `initialize.sh` runs again -- which happens automatically on the next **Reopen in Container**, but
  not mid-session. If you ever see a `postCreateCommand`/`postStartCommand` fail with a script "not
  found" despite the file clearly being there, or a build behaving like it belongs to a different
  branch, suspect a stale shared container from another checkout: `docker compose down` from the
  checkout you're trying to use, then bring the stack back up.
- **The Ports panel fills up** (30-40 entries). Positron auto-forwards many internal `127.0.0.1`
  ports (extension hosts, language servers, kernels); only the four labeled ones
  (8080/9323/6080/5900) matter. Run **Remote: Close Unused Ports** to declutter.
- **After editing test-infra files** (`test/e2e/infra/...`), run **Developer: Reload Window** so the
  Playwright extension picks them up (it caches transpiles in a worker).
