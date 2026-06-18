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
| `POSITRON_DEV_LICENSE` | 1Password → IDE/Workbench vault (the dev license key) |
| `POSITRON_CI_IMAGE_TAG` | Defaults to the current CI tag (`127`); override to pin a specific CI run |
| `POSITRON_CI_IMAGE_ARCH` | `arm64` (default). `amd64` is not yet usable — no amd64 image is published |

`.devcontainer/ci-arm/.env` is gitignored — your secrets never get committed.

## Open it

Open your Positron checkout, then **Dev Containers: Reopen in Container** and pick
**"Positron CI (arm e2e-electron)"**.

- The workspace is a **bind mount** of your checkout, so your edits live on your host disk.
- `node_modules`, `test/e2e/node_modules`, and `.build` are kept on fast Docker volumes
  (they build at native Linux speed and don't pollute your host tree).
- First open runs `post-create.sh` — the full build (`npm ci`, compile, Electron, Playwright,
  license). This is slow the first time. `post-start.sh` then starts Xvfb and checks the DB.

To get the task/debug buttons below, open the workspace file
`.devcontainer/ci-arm/positron-ci.code-workspace` (it scopes the CI tasks/launch without
touching the repo's shared `.vscode/`).

## Run / debug / test

| How | What it does |
|---|---|
| **Run Task → Run e2e-electron (connections)** | `npx playwright test --project e2e-electron --grep @:connections` |
| **Test Explorer** (Playwright extension) | run any single test from the gutter — the CI-repro loop |
| **F5 → Debug e2e-electron (connections)** | run Playwright under the debugger; breakpoints in TS |
| **Run Task → Start Positron server** | serves Positron at http://localhost:8080/?tkn=dev-token |
| **Run Task → Show Playwright report** | serves the report at http://localhost:9323 |

## Updating the image tag

When CI bumps the image, update the `POSITRON_CI_IMAGE_TAG` default (and/or set it in `.env`).
A tag change requires **Dev Containers: Rebuild Container** — a changed `.env` alone won't
trigger a rebuild.

## Limitations

- **arm64 only.** The image suffix and Electron build are arch-parameterized, but no amd64
  image is published yet, so Windows/Intel-Mac aren't usable until one is.
- **No desktop-app/VNC view.** Use the browser server (`:8080`) for interactive Positron;
  headless Xvfb backs the e2e runs.
- **First build is slow.** Compiling Positron in `post-create` takes a while; subsequent opens
  reuse the volumes.
