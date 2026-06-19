# Positron CI dev container (ubuntu24-arm64)

Develop, debug, and run Positron **inside the actual CI image**
(`ghcr.io/posit-dev/positron-ubuntu24-arm64`) so CI failures reproduce locally. This is a second
dev container alongside the repo's generic `.devcontainer/devcontainer.json`; it doesn't replace it.

> **This file is setup + reference.** For day-to-day use — running tests, debugging, exploring the
> app in the browser or via VNC — see **[DEVELOPING.md](DEVELOPING.md)**.

> Validated on **arm64** (Apple Silicon). amd64 images exist (CI uses them) but this config isn't
> validated on amd64/Windows yet.

## Prerequisites

1. **Docker Desktop**, with enough resources: **8+ CPU, 16 GB RAM**, and disk headroom (image +
   `node_modules` + build run to several GB). Settings → Resources → Advanced. Enable **VirtioFS**
   for best bind-mount performance.
2. **GHCR login** (the images are private):
   ```bash
   docker login ghcr.io -u <your_github_username>   # password = a GitHub PAT with read:packages
   ```
3. **Dev Containers extension** (use VS Code as the client — the extension may not run in Positron).

## One-time setup

```bash
cp .devcontainer/ci-arm/.env.example .devcontainer/ci-arm/.env
```

| Secret | Where |
|---|---|
| `E2E_POSTGRES_USER` / `E2E_POSTGRES_PASSWORD` | 1Password → *Positron > E2E Postgres DB Connection info* |
| license | dev license PEM (1Password → IDE/Workbench vault) — as a **file**, see below |
| `POSITRON_CI_IMAGE_TAG` | defaults to the current CI tag (`127`); override to pin a CI run |
| `POSITRON_CI_IMAGE_ARCH` | `arm64` (default, validated) |

**License is a multi-line PEM key**, which a `.env` can't hold — save the whole
`-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----` block to:

```
.devcontainer/ci-arm/license.txt
```

`post-create.sh` installs it as the `pdol_rsa` signing key. Two license paths exist and both are
handled for you: the **e2e-electron** tests use this signing key directly; the **browser server**
needs a *generated* key, which the "Start server" task issues with `pdol` automatically.

`.env` and `license.txt` are gitignored.

## Open it

Open your Positron checkout (a regular clone **or a git worktree**), then **Dev Containers: Reopen
in Container** → **Positron CI (ubuntu24-arm64)**.

- The workspace is a **bind mount** of your checkout — edits live on your host disk; normal file
  navigation works.
- `node_modules`, `test/e2e/node_modules`, `.build` are on fast Docker volumes; `out/` is on the
  bind mount (the compile recreates it).
- **Worktrees just work** — a host-side `initializeCommand` auto-detects your checkout + git dir and
  mounts both. (Must be a full clone; a *shallow* clone can't build — compile needs git history.)
- **First open runs the cold build** (`post-create.sh`): `npm ci` + compile + Electron + Playwright,
  ~10 min once per machine; it persists on the volumes. `post-start.sh` then starts Xvfb, VNC, and
  the build doctor.

Tasks + the debug config live in `.vscode/`, prefixed **`Positron CI:`** (Run Task → type
"Positron CI"). **Then see [DEVELOPING.md](DEVELOPING.md).**

## Updating the image tag

When CI bumps the image, update `POSITRON_CI_IMAGE_TAG` (default, or in `.env`). A tag change needs
**Dev Containers: Rebuild Container** — a changed `.env` alone won't trigger a rebuild.

## Limitations & gotchas

- **arm64 validated only.** Arch is parameterized and amd64 images exist, but amd64/Windows is
  unvalidated. No noVNC in the image, so Windows users would need a VNC client.
- **One instance** at a time.
- **First build ~10 min** (one-time, then incremental). A prebuilt image could make first open
  near-instant later — see the design doc.
- **`npm ci` may leave files staged in your worktree** — Positron's postinstall runs
  `git add --renormalize`; because your checkout is bind-mounted, it stages line-ending changes in
  your real index. Harmless: `git restore --staged .`.
- **`out/` is on your host disk** (it can't be a volume — the compile `rmdir`s it). If you *also*
  build natively on the same checkout, the two builds share `out/` and clobber each other; recompile
  after switching.
- **After editing test-infra files** (`test/e2e/infra/…`), run **Developer: Reload Window** so the
  Playwright extension picks them up (it caches transpiles in a worker).
