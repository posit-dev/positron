# Local Workbench QA Experience (`npm run wb`)

**Date:** 2026-06-25
**Status:** Design / approved for planning
**Repos touched:** `posit-dev/positron` (new orchestration + workspace), `posit-dev/qa-example-content` (existing install scripts, unchanged source of truth)

## Problem

QA frequently needs to run a specific **Positron** build against a specific **Workbench** version together, locally, to reproduce and file bugs. Today that means leaving the Positron repo, going to `qa-example-content/dockerfiles/wb-local`, and doing a multi-step "song and dance":

- Two terminals (`wb:start` in one, `GITHUB_TOKEN=... wb:connect` in another).
- Hunting the Posit website for the right Workbench `.deb` URL.
- Manual `.env` setup; the `vscode-tkn` "Forbidden" cookie gotcha on first login.

The core annoyance is **having to leave Positron at all**, plus version-hunting.

## Goal

A single front door, **run from the Positron repo**, that brings up the Workbench stack and lets QA pick both versions from menus -- no cross-repo hop, no URL hunting. Released combos are the primary use; running the *current source tree* under Workbench is a near-free bonus that also covers the dev case.

## Non-goals (YAGNI)

- **No VNC / noVNC.** Unlike the `.devcontainer/ci-arm` work (PR #14389), Workbench is already a browser app at `:8787` -- nothing to "view" via a virtual display.
- **No new dev container.** This reuses the existing `dockerfiles/docker-compose.workbench.yml`.
- **No deep Workbench version history.** The public feeds expose only current stable + current daily; a specific older build is handled by paste-a-URL, not enumeration.
- **No fork of the install logic.** `qa-example-content/dockerfiles/wb-local/*.sh` stays the single source of truth; we pull it the same way CI already does.
- **No change to the `e2e-workbench` Playwright project** -- it already targets `:8787`.

## Architecture

```
positron repo
  dockerfiles/
    docker-compose.workbench.yml      (exists; gains arch awareness)
    workbench-local.sh                (NEW: orchestrator + subcommands)
  positron.workbench.code-workspace   (NEW: thin task-button veneer)
  package.json                        ("wb": "bash dockerfiles/workbench-local.sh")

qa-example-content (unchanged, source of truth, pulled via curl or local checkout)
  dockerfiles/wb-local/install-workbench.sh
  dockerfiles/wb-local/positronDownload.sh
  dockerfiles/wb-local/get-latest-wb-noble-url.sh
  dockerfiles/wb-local/configure-datasources.sh
```

**Single source of truth for install logic.** `workbench-local.sh` obtains the `wb-local` scripts the same way `.github/actions/setup-workbench-docker/action.yml` does -- `curl` from `qa-example-content@main` -- and `docker cp`s them into the `test` container. If a local qa-example-content checkout is detected (env `QA_CONTENT_DIR`, or a sibling clone), it uses that instead so local script edits are testable.

**Subcommands carry all logic; buttons are a veneer.** Everything lives in `workbench-local.sh <subcommand>`. The workspace tasks just call those subcommands, so there is no duplicated logic and the CLI works headless/CI.

## Components

### 1. `workbench-local.sh` (orchestrator)

Default (`npm run wb`, no subcommand): **up + interactive install.**

1. Bootstrap `.env` (copy from a template; prompt for the few required values -- `WB_PASSWORD`, postgres creds -- if missing, instead of failing).
2. Detect arch (`arm64` on Apple Silicon, `amd64` otherwise); export so compose selects matching image tags.
3. `docker compose -f dockerfiles/docker-compose.workbench.yml up -d` (**detached** -- this is what removes the second terminal).
4. Wait for `test` + `postgres` (+ `connect`) healthy.
5. Pull/copy the `wb-local` scripts into the container.
6. Run the **two pickers** (below), then `install-workbench.sh` with the chosen WB source, then install the chosen Positron.
7. Print access info (`:8787` user1 / WB_PASSWORD, `:3939` Connect) and the Forbidden-cookie note.

Subcommands:

| Subcommand | Action |
|---|---|
| (default) | up + pickers + install |
| `status` | **Doctor**: container states, `rstudio-server` up?, currently installed Positron + WB versions, access URLs, and the fix-it hint for any red row |
| `report` | Emit a paste-able env snippet for bug reports: Positron `<ver>` under Workbench `<ver>`, container states, arch |
| `logs [service]` | Tail `rstudio-server` / `connect` / container logs |
| `test [grep]` | Run the `e2e-workbench` Playwright project against the live `:8787` |
| `restart` | `rstudio-server restart` (inner loop after a source overlay) |
| `stop` | `docker compose ... down` |

### 2. Version pickers

**Positron picker** -- last 5 releases + local:
- Source: `gh api repos/posit-dev/positron-builds/releases`, filtered to releases carrying a `positron-workbench-linux-<arch>-<tag>.tar.gz` asset (this is the artifact `positronDownload.sh` consumes -- *not* the CDN `reh` template). Show tag + date.
- Released selection -> `positronDownload.sh` with `TAG=<tag>`.
- Final entry **"Local source build (current repo)"** -> `npm run gulp vscode-reh-web-pwb-linux-<arch>` in the current Positron checkout, producing `../vscode-reh-web-pwb-linux-<arch>/`, then the **overlay recipe** (from the CI action): replace `/usr/lib/rstudio-server/bin/positron-server/new`, `chown -R rstudio-server:rstudio-server`, `rstudio-server restart`.

**Workbench picker** -- Stable / Daily / Custom:
- **Stable**: `downloads.json` -> `.rstudio.pro.stable.server.installer.noble.url`; for arm64, rewrite `amd64`->`arm64` and verify the artifact exists (logic already in `get-latest-wb-noble-url.sh`).
- **Daily**: `dailies.rstudio.com/.../index.json` -> latest server build for the matching distro/arch (e.g. `s3.amazonaws.com/rstudio-ide-build/server/jammy/arm64/rstudio-workbench-<ver>.proN-arm64.deb`).
- **Custom URL**: paste a specific `.deb` (e.g. an older daily S3 link). Mirrors today's "specific versions" path.
- Chosen URL is handed to `install-workbench.sh`.

### 3. `docker-compose.workbench.yml` arch awareness

Currently pins amd64 images (`positron-ubuntu24-amd64`, `positron-postgres-amd64`). Add arch-driven image selection (env-substituted tag/suffix, as `wb-local/run.sh` does) so Apple Silicon QA gets `*-arm64`. Note: the `connect` image is amd64-only and runs emulated on arm64 (`platform: linux/amd64`) -- acceptable, matches `wb-local`.

### 4. `positron.workbench.code-workspace` (button veneer)

A workspace with task buttons mapping 1:1 to subcommands: **Up**, **Status (Doctor)**, **Report**, **Logs**, **Run @:workbench tests**, **Restart server**, **Stop**, plus **Open Workbench (:8787)** / **Open Connect (:3939)**. Each task is `bash dockerfiles/workbench-local.sh <subcommand>`. No VNC tasks.

## Data flow (released combo, the common case)

1. `npm run wb` -> compose up -d -> wait healthy.
2. Positron picker -> pick a `positron-builds` release tag.
3. Workbench picker -> pick Stable.
4. `install-workbench.sh` installs WB; `positronDownload.sh TAG=<tag>` installs Positron into `/usr/lib/rstudio-server/bin/positron-server/new`.
5. Print access info -> open `:8787`, log in as `user1`.

## Data flow (local source under Workbench)

1. `npm run wb` -> compose up -d.
2. Workbench picker -> Stable/Daily; install WB.
3. Positron picker -> **Local source build** -> `gulp vscode-reh-web-pwb-linux-<arch>` in current repo -> overlay into `.../positron-server/new` -> `rstudio-server restart`.
4. Iterate: edit source -> `npm run wb` re-overlay, or rebuild + `workbench-local.sh restart`.

## Error handling / rough edges

- **Missing `GITHUB_TOKEN`**: clear message up front (needed for `positron-builds` + ghcr image pull).
- **`.env` missing/incomplete**: bootstrap from template, prompt for required values.
- **`vscode-tkn` "Forbidden" on first login**: print a one-line remedy (clear the `vscode-tkn` cookie for `localhost`) with the existing doc image; auto-clear only if scriptable.
- **arm64 WB artifact missing for a chosen version**: fail with the resolved URL shown (reuse `get-latest-wb-noble-url.sh` verification).
- **Licenses**: `workbench.lic` / `connect.lic` discovery + copy, mirroring `wb-local`/the CI action.

## Prerequisites (documented in the script's `--help` and a short README)

- `docker login ghcr.io` with a PAT (`read:packages`).
- `GITHUB_TOKEN` exported.
- Docker Desktop resources (8+ CPU, 16GB RAM) -- same as `wb-local`.
- `gh` CLI authenticated (for the Positron release list).

## Testing

- **Manual (primary):** released combo on arm64 (stable + a `positron-builds` release); local-source combo (build + overlay + login); `status`/`report` output sanity; `test` subcommand runs `e2e-workbench`.
- **Script-level:** picker URL-resolution functions (stable rewrite, daily resolve, release filter) are pure-ish and can be smoke-tested with fixture JSON. Keep coverage proportional -- one happy-path check per resolver, not exhaustive.
- No new Vitest/e2e in the Positron app itself; this is tooling.

## Open questions

- Exact path for the orchestrator (`dockerfiles/workbench-local.sh` vs `scripts/`) -- cohesion with the compose file favors `dockerfiles/`.
- Whether to auto-detect a sibling `qa-example-content` checkout vs requiring `QA_CONTENT_DIR`.
