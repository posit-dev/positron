# CI Dev Container — arm e2e-electron

Edit Positron in VS Code or Positron, but build/run/debug **inside the actual CI image**
(`ghcr.io/posit-dev/positron-ubuntu24-arm64`) so CI failures can be reproduced and fixed
locally. This is a second dev container alongside the generic `.devcontainer/devcontainer.json`;
it does not replace it.

> **Scope:** arm64 + `e2e-electron` only. Workbench, Jupyter, amd64/Windows, and the VNC
> desktop-app view are out of scope for this version (see "Limitations").

## Prerequisites

1. **Docker Desktop**, with enough resources: **8+ CPU, 16 GB RAM**, and disk headroom
   (the image + `node_modules` + build run to several GB). Settings → Resources → Advanced.
   Enable **VirtioFS** file sharing for best performance with the bind-mounted source.
2. **GHCR login** (the images are private):
   ```bash
   docker login ghcr.io -u <your_github_username>
   # password = a GitHub PAT with read:packages scope
   ```
3. **Dev Containers extension** in VS Code or Positron.

## One-time setup

Copy the env template and fill it from 1Password:

```bash
cp .devcontainer/ci-arm/.env.example .devcontainer/ci-arm/.env
```

| Variable | Where to get it |
|---|---|
| `E2E_POSTGRES_USER`, `E2E_POSTGRES_PASSWORD` | 1Password → *Positron > E2E Postgres DB Connection info* |
| license | The dev license PEM (1Password → IDE/Workbench vault) — saved as a **file**, not in `.env`; see below |
| `POSITRON_CI_IMAGE_TAG` | Defaults to the current CI tag (`127`); override to pin a specific CI run |
| `POSITRON_CI_IMAGE_ARCH` | `arm64` (default, validated). `amd64` images exist (CI uses them) but this config isn't validated on amd64 yet |

**The license is a multi-line PEM key** (`-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`),
so it goes in a **file, not `.env`**. Save the whole block to:

```
.devcontainer/ci-arm/license.txt
```

`post-create.sh` installs it into the image at the path the build expects. (CI instead injects the
raw multi-line `POSITRON_DEV_LICENSE` env var — the build handles both.)

Both `.devcontainer/ci-arm/.env` and `.devcontainer/ci-arm/license.txt` are gitignored — your
secrets never get committed.

## Open it

Open your Positron checkout (a regular clone **or a git worktree** both work), then
**Dev Containers: Reopen in Container** and pick **"Positron CI (arm e2e-electron)"**.

- The workspace is a **bind mount** of your checkout, so your edits live on your host disk and
  you keep normal file navigation (Finder, host tools).
- `node_modules`, `test/e2e/node_modules`, `.build`, and `out` live on fast Docker volumes
  (native Linux speed, no clobbering a host-side native build, host tree stays clean).
- **Worktrees just work.** A host-side `initializeCommand` auto-detects your checkout path and
  the repo's git dir and mounts both, so git is fully functional inside the container. No setup.
  (The checkout must be a full clone — a *shallow* clone can't build, since the compile needs
  git history.)
- First open runs `post-create.sh` — the full build (`npm ci`, compile, Electron, Playwright,
  license). `post-start.sh` then starts Xvfb and checks the DB.

To get the task/debug buttons below, open the workspace file
`.devcontainer/ci-arm/positron-ci.code-workspace` (it scopes the CI tasks/launch without
touching the repo's shared `.vscode/`).

## Run / debug / test

| How | What it does |
|---|---|
| **Run Task → Watch (incremental build)** | `npm run watch` — run once; recompiles changed files on save (seconds). This is your inner-loop build. |
| **Run Task → Run e2e-electron (connections)** | `npx playwright test --project e2e-electron --grep @:connections` |
| **Test Explorer** (Playwright extension) | run any single test from the gutter — the CI-repro loop |
| **F5 → Debug e2e-electron (connections)** | run Playwright under the debugger; breakpoints in TS |
| **Run Task → Start Positron server** | serves Positron at http://localhost:8080/?tkn=dev-token |
| **Run Task → Show Playwright report** | serves the report at http://localhost:9323 |
| **Run Task → Check build status (doctor)** | reports whether the build is current and what (if anything) to rebuild |
| **Run Task → Reinstall deps (npm ci)** | after a pull/branch-switch changed `package-lock.json` |
| **Run Task → Full rebuild (post-create)** | re-run the whole cold build (idempotent) |

## The build, and your inner loop

First open runs a **full cold build** (`npm ci` + compile + Electron + Playwright) — about
**10 min** on Apple Silicon (`npm ci` is the long pole at ~6 min; compile is ~3 min), once per
machine; it persists on Docker volumes across restarts/rebuilds. After that you work in
the **incremental** loop: start **Watch (incremental build)** once, then edit → save → it
recompiles changed files in seconds → run/debug. Editing and debugging do *not* re-trigger the
cold build. You only pay more when dependencies change (`npm ci` again), native modules change,
or you start from a fresh machine/wiped volumes.

**How do you know when you need to rebuild?** You don't have to guess — a **build doctor** runs
automatically on every container start (and is available as the **Check build status (doctor)**
task for mid-session checks, e.g. after a `git pull`). It compares your `package-lock.json`
against the last successful install and checks for compiled output / Electron / a completed cold
build, then tells you exactly which task to run (`Reinstall deps`, `Watch`, `Full rebuild`).
A clean checkout with watch running needs nothing.

## Updating the image tag

When CI bumps the image, update the `POSITRON_CI_IMAGE_TAG` default (and/or set it in `.env`).
A tag change requires **Dev Containers: Rebuild Container** — a changed `.env` alone won't
trigger a rebuild.

## Limitations

- **arm64 only (validated).** The image suffix and Electron build are arch-parameterized and
  amd64 images exist (CI runs on them), but this config hasn't been validated on amd64/Windows.
- **No desktop-app/VNC view.** Use the browser server (`:8080`) for interactive Positron;
  headless Xvfb backs the e2e runs.
- **One instance.** Designed for a single dev/debug container at a time.
- **First build is ~10 min** (one-time, then incremental). A prebuilt image could make first
  open near-instant later — see the design doc.

## Gotchas (because the source is bind-mounted)

- **`npm ci` may leave files staged in your worktree.** Positron's postinstall runs
  `git add --renormalize` (line-ending normalization). Because your checkout is bind-mounted,
  that stages files in your real git index. It's harmless — clear it with
  `git restore --staged .`. (You'd hit the same thing building natively.)
- **`out/` lives on your host disk, not a volume** (the compile deletes and recreates `out/`,
  which can't be done to a mount point). If you *also* build Positron natively on the same
  checkout, both builds share `out/` and will clobber each other — just recompile after
  switching between native and container.
