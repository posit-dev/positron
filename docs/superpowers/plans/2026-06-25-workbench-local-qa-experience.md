# Local Workbench QA Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-review deviations (do NOT implement the following from this plan).** These were built and then intentionally removed/changed during implementation review; the original task text below is kept for history but is superseded:
> - **Local source build / `cmd_overlay` / `WB_SOURCE_LOCAL`** (Task 5 and the "Local source build" entry in the Positron picker, Task 4) -- **removed**. The tool installs released Positron only; the Positron picker is Release/Daily channels of *released* builds.
> - **`positron.workbench.code-workspace` task-button file** (Task 7, Step 3) -- **removed**. Manage the stack via the CLI subcommands; there is no workspace file.
> - **Workbench picker** is Release / Daily (each the single current build) / Custom `.deb` URL -- there is no Workbench version list.
> - **Positron release list** comes from `posit-dev/positron` releases (`prerelease=false`), not `positron-builds`; the **Global Constraint below about `positron-builds` being all `prerelease=true` is obsolete** for the release list.
> - Added subcommands not in the original task text: `--reinstall`, and the Workbench `.deb` arch/reachability validation.

**Goal:** A single `npm run wb` front door in the Positron repo that brings up the Workbench stack and lets QA pick a Positron build (last-5 releases or the current source tree) and a Workbench version (stable/daily/custom), removing the qa-example-content two-terminal dance.

**Architecture:** A bash orchestrator (`dockerfiles/workbench-local.sh`) drives the existing `dockerfiles/docker-compose.workbench.yml` stack. Pure URL/arch resolver functions live in a sourceable lib (`dockerfiles/workbench-local-lib.sh`) and are unit-tested with fixtures. The orchestrator reuses qa-example-content's `install-workbench.sh` (pulled via `curl`, as CI already does) by exporting `WB_URL` / `POSITRON_TAG` / `ARCH_SUFFIX`. A `.code-workspace` file exposes subcommands as clickable tasks.

**Tech Stack:** Bash, Docker Compose, `gh` CLI, `jq`, `curl`. No app code changes.

## Global Constraints

- **Two arch tokens, one source (`uname -m`):** `POSITRON_ARCH` is `x64`|`arm64` (Positron artifact filenames + gulp tasks); `WB_ARCH` is `amd64`|`arm64` (Workbench `.deb`, Docker image tags, `ARCH_SUFFIX`). Mapping: `x86_64`/`amd64` -> `x64`+`amd64`; `aarch64`/`arm64` -> `arm64`+`arm64`. Never use a single `<arch>`.
- **`install-workbench.sh` integration contract (env vars):** `WB_URL` (exact `.deb` URL; empty = script fetches latest), `POSITRON_TAG` (positron-builds tag; empty = latest), `ARCH_SUFFIX` (= `WB_ARCH`), `GITHUB_TOKEN` (required). Optional `--credentials=databricks|snowflake|azure`.
- **`positron-builds` releases are all `prerelease=true`.** Never filter to `prerelease == false` -- it returns nothing.
- **qa-example-content scripts are the source of truth.** Pull `install-workbench.sh`, `positronDownload.sh`, `get-latest-wb-noble-url.sh`, `configure-datasources.sh` via `curl` from `@main`; if `QA_CONTENT_DIR` is set or a sibling `qa-example-content` checkout exists, copy from there instead.
- **Code style:** tabs for indentation in any TS/JS touched; ASCII only (no smart quotes / em-dashes); shell scripts start with `#!/usr/bin/env bash` and `set -euo pipefail` where practical.
- **Compose arch awareness (Task 1) must land in the same PR** as the orchestrator; shipping the orchestrator without it silently pulls the wrong image on arm64.

---

### Task 1: Make `docker-compose.workbench.yml` arch-aware

**Files:**
- Modify: `dockerfiles/docker-compose.workbench.yml`

**Interfaces:**
- Consumes: env `ARCH_SUFFIX` (`amd64`|`arm64`), `WB_IMAGE_TAG`, `PG_IMAGE_TAG` (with sane defaults).
- Produces: a compose file whose `test` and `postgres` image tags follow `ARCH_SUFFIX`. Later tasks run `docker compose -f dockerfiles/docker-compose.workbench.yml`.

- [ ] **Step 1: Edit the `test` and `postgres` image lines to be env-substituted**

In `dockerfiles/docker-compose.workbench.yml`, change:

```yaml
  test:
    image: ghcr.io/posit-dev/positron-ubuntu24-amd64:141
```
to:
```yaml
  test:
    image: ghcr.io/posit-dev/positron-ubuntu24-${ARCH_SUFFIX:-amd64}:${WB_IMAGE_TAG:-141}
```

and change:
```yaml
  postgres:
    image: ghcr.io/posit-dev/positron-postgres-amd64:142
```
to:
```yaml
  postgres:
    image: ghcr.io/posit-dev/positron-postgres-${ARCH_SUFFIX:-amd64}:${PG_IMAGE_TAG:-142}
```

Leave the `connect` service unchanged (it stays `platform: linux/amd64`, emulated on arm64).

- [ ] **Step 2: Verify substitution renders per arch**

Run:
```bash
ARCH_SUFFIX=arm64 docker compose -f dockerfiles/docker-compose.workbench.yml config | grep -E "image:.*positron-(ubuntu24|postgres)"
```
Expected: lines show `positron-ubuntu24-arm64:141` and `positron-postgres-arm64:142`.

Run:
```bash
ARCH_SUFFIX=amd64 docker compose -f dockerfiles/docker-compose.workbench.yml config | grep -E "image:.*positron-(ubuntu24|postgres)"
```
Expected: `...-amd64:141` and `...-amd64:142`.

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/docker-compose.workbench.yml
git commit -m "feat(wb-local): make workbench compose image tags arch-aware"
```

---

### Task 2: Resolver library (arch detection + version URLs)

**Files:**
- Create: `dockerfiles/workbench-local-lib.sh`
- Test: `dockerfiles/test/workbench-local-lib.test.sh`
- Create (fixtures): `dockerfiles/test/fixtures/downloads.json`, `dockerfiles/test/fixtures/dailies.json`, `dockerfiles/test/fixtures/releases.json`

**Interfaces:**
- Produces (sourceable functions):
  - `wb_detect_arch [uname_value]` -> sets globals `POSITRON_ARCH`, `WB_ARCH`; returns 1 on unsupported.
  - `wb_resolve_stable_url <wb_arch>` -> echoes the stable Workbench `.deb` URL.
  - `wb_resolve_daily_url <wb_arch>` -> echoes the latest daily Workbench `.deb` URL.
  - `wb_list_positron_releases <count>` -> echoes up to `<count>` lines of `TAG<TAB>DATE`, newest first, including prereleases.
  - Indirection seams (overridable in tests): `_wb_fetch_downloads_json`, `_wb_fetch_dailies_json`, `_wb_fetch_releases_json` (each echoes JSON to stdout).

- [ ] **Step 1: Write the fixtures**

Create `dockerfiles/test/fixtures/downloads.json`:
```json
{ "rstudio": { "pro": { "stable": { "server": { "installer": { "noble": {
  "url": "https://download2.rstudio.org/server/noble/amd64/rstudio-workbench-2026.05.1-225.pro10-amd64.deb"
} } } } } } }
```

Create `dockerfiles/test/fixtures/dailies.json`:
```json
{ "products": { "server": { "platforms": {
  "noble-amd64": { "link": "https://s3.amazonaws.com/rstudio-ide-build/server/noble/amd64/rstudio-workbench-2026.06.0-242.pro7-amd64.deb" },
  "noble-arm64": { "link": "https://s3.amazonaws.com/rstudio-ide-build/server/noble/arm64/rstudio-workbench-2026.06.0-242.pro7-arm64.deb" }
} } } }
```

Create `dockerfiles/test/fixtures/releases.json` (note: every entry `prerelease: true`):
```json
[
  { "tag_name": "2026.06.1-6",   "published_at": "2026-06-23T21:21:28Z", "prerelease": true,
    "assets": [ { "name": "positron-workbench-linux-arm64-2026.06.1-6.tar.gz" } ] },
  { "tag_name": "2026.06.0-211", "published_at": "2026-06-01T15:25:38Z", "prerelease": true,
    "assets": [ { "name": "positron-workbench-linux-arm64-2026.06.0-211.tar.gz" } ] },
  { "tag_name": "2026.05.2-3",   "published_at": "2026-05-14T15:33:42Z", "prerelease": true,
    "assets": [ { "name": "positron-workbench-linux-x64-2026.05.2-3.tar.gz" } ] }
]
```

- [ ] **Step 2: Write the failing test**

Create `dockerfiles/test/workbench-local-lib.test.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${HERE}/../workbench-local-lib.sh"

fail=0
check() { # desc expected actual
	if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# Override fetch seams to read fixtures (no network)
_wb_fetch_downloads_json() { cat "${HERE}/fixtures/downloads.json"; }
_wb_fetch_dailies_json()   { cat "${HERE}/fixtures/dailies.json"; }
_wb_fetch_releases_json()  { cat "${HERE}/fixtures/releases.json"; }

# arch detection
wb_detect_arch "x86_64"; check "x86_64 -> POSITRON_ARCH" "x64" "$POSITRON_ARCH"; check "x86_64 -> WB_ARCH" "amd64" "$WB_ARCH"
wb_detect_arch "arm64";  check "arm64 -> POSITRON_ARCH" "arm64" "$POSITRON_ARCH"; check "arm64 -> WB_ARCH" "arm64" "$WB_ARCH"

# stable url: amd64 passthrough, arm64 rewrite
check "stable amd64" \
	"https://download2.rstudio.org/server/noble/amd64/rstudio-workbench-2026.05.1-225.pro10-amd64.deb" \
	"$(wb_resolve_stable_url amd64)"
check "stable arm64 rewrite" \
	"https://download2.rstudio.org/server/noble/arm64/rstudio-workbench-2026.05.1-225.pro10-arm64.deb" \
	"$(wb_resolve_stable_url arm64)"

# daily url for arm64
check "daily arm64" \
	"https://s3.amazonaws.com/rstudio-ide-build/server/noble/arm64/rstudio-workbench-2026.06.0-242.pro7-arm64.deb" \
	"$(wb_resolve_daily_url arm64)"

# release list includes prereleases, newest first, capped
check "releases newest tag" "2026.06.1-6" "$(wb_list_positron_releases 5 | head -1 | cut -f1)"
check "releases count capped" "2" "$(wb_list_positron_releases 2 | wc -l | tr -d ' ')"

exit $fail
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bash dockerfiles/test/workbench-local-lib.test.sh`
Expected: FAIL -- `workbench-local-lib.sh` does not exist yet (source error / functions undefined).

- [ ] **Step 4: Write the resolver library**

Create `dockerfiles/workbench-local-lib.sh`:
```bash
#!/usr/bin/env bash
# Pure-ish resolver functions for workbench-local.sh. Network access is isolated
# in the _wb_fetch_* seams so tests can stub them with fixtures.

wb_detect_arch() {
	local m="${1:-$(uname -m)}"
	case "$m" in
		x86_64|amd64)  POSITRON_ARCH="x64";   WB_ARCH="amd64" ;;
		aarch64|arm64) POSITRON_ARCH="arm64"; WB_ARCH="arm64" ;;
		*) echo "Unsupported architecture: $m" >&2; return 1 ;;
	esac
	export POSITRON_ARCH WB_ARCH
}

_wb_fetch_downloads_json() { curl -sL "https://posit.co/wp-content/uploads/downloads.json"; }
_wb_fetch_dailies_json()   { curl -sL "https://dailies.rstudio.com/rstudio/latest/index.json"; }
_wb_fetch_releases_json()  { gh api "repos/posit-dev/positron-builds/releases?per_page=30"; }

wb_resolve_stable_url() {
	local wb_arch="$1" url
	url="$(_wb_fetch_downloads_json | jq -r '.rstudio.pro.stable.server.installer.noble.url')"
	[ -n "$url" ] && [ "$url" != "null" ] || { echo "Failed to resolve stable URL" >&2; return 1; }
	if [ "$wb_arch" = "arm64" ]; then url="$(echo "$url" | sed 's/amd64/arm64/g')"; fi
	echo "$url"
}

wb_resolve_daily_url() {
	local wb_arch="$1" url
	# Prefer noble for the arch; the index keys platforms as "<distro>-<arch>".
	url="$(_wb_fetch_dailies_json | jq -r --arg k "noble-${wb_arch}" '.products.server.platforms[$k].link // empty')"
	[ -n "$url" ] || { echo "No daily build for noble-${wb_arch}" >&2; return 1; }
	echo "$url"
}

wb_list_positron_releases() {
	local count="${1:-5}"
	# Include prereleases (every positron-builds release is prerelease=true).
	_wb_fetch_releases_json \
		| jq -r --argjson n "$count" '
			[ .[] | select(any(.assets[]?; .name | test("^positron-workbench-linux-(x64|arm64)-"))) ]
			| sort_by(.published_at) | reverse | .[:$n]
			| .[] | "\(.tag_name)\t\(.published_at)"'
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash dockerfiles/test/workbench-local-lib.test.sh`
Expected: all lines `ok`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add dockerfiles/workbench-local-lib.sh dockerfiles/test/
git commit -m "feat(wb-local): add arch + version resolver lib with fixture tests"
```

---

### Task 3: Orchestrator skeleton (dispatch, .env bootstrap, up, re-entry)

**Files:**
- Create: `dockerfiles/workbench-local.sh`
- Create: `dockerfiles/.env.example` (workbench-local template)

**Interfaces:**
- Consumes: `dockerfiles/workbench-local-lib.sh` (Task 2); `dockerfiles/docker-compose.workbench.yml` (Task 1).
- Produces: `workbench-local.sh <subcommand>` dispatch with `up` (default), `status`, `stop`, `down`. Helper functions `wb_compose` (wraps `docker compose -f ...`), `wb_stack_up` (bool), `wb_installed` (bool), `wb_bootstrap_env`, `wb_fetch_scripts`.

- [ ] **Step 1: Write the `.env.example` template**

Create `dockerfiles/.env.example`:
```bash
# Copy to dockerfiles/.env and fill in. Required values are prompted if missing.
E2E_POSTGRES_USER=testuser
E2E_POSTGRES_PASSWORD=testpassword
WB_PASSWORD=testpassword
# Optional overrides:
# WB_IMAGE_TAG=141
# PG_IMAGE_TAG=142
# QA_CONTENT_DIR=/path/to/qa-example-content
```

- [ ] **Step 2: Write the orchestrator skeleton**

Create `dockerfiles/workbench-local.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.workbench.yml"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/workbench-local-lib.sh"

WB_URL_BASE="https://raw.githubusercontent.com/posit-dev/qa-example-content/main/dockerfiles/wb-local"
WB_SCRIPTS="install-workbench.sh positronDownload.sh get-latest-wb-noble-url.sh configure-datasources.sh"

wb_compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

wb_stack_up() { docker ps --format '{{.Names}}' | grep -q '^test$'; }

wb_installed() {
	docker exec test bash -c 'test -f /usr/lib/rstudio-server/bin/positron-server/new/product.json' 2>/dev/null
}

wb_bootstrap_env() {
	local env_file="${SCRIPT_DIR}/.env"
	[ -f "$env_file" ] || cp "${SCRIPT_DIR}/.env.example" "$env_file"
	# shellcheck source=/dev/null
	set -a; source "$env_file"; set +a
	if [ -z "${WB_PASSWORD:-}" ]; then
		read -r -p "Workbench password for user1: " WB_PASSWORD; export WB_PASSWORD
	fi
	: "${E2E_POSTGRES_USER:=testuser}"; : "${E2E_POSTGRES_PASSWORD:=testpassword}"
	export E2E_POSTGRES_USER E2E_POSTGRES_PASSWORD
}

wb_fetch_scripts() {
	local src="${QA_CONTENT_DIR:-}"
	if [ -z "$src" ] && [ -d "${REPO_ROOT}/../qa-example-content/dockerfiles/wb-local" ]; then
		src="$(cd "${REPO_ROOT}/../qa-example-content" && pwd)"
	fi
	for s in $WB_SCRIPTS; do
		if [ -n "$src" ] && [ -f "${src}/dockerfiles/wb-local/${s}" ]; then
			docker cp "${src}/dockerfiles/wb-local/${s}" "test:/tmp/${s}" >/dev/null
		else
			curl -fsSL "${WB_URL_BASE}/${s}" -o "/tmp/${s}"
			docker cp "/tmp/${s}" "test:/tmp/${s}" >/dev/null
		fi
		docker exec test sed -i 's/\r$//' "/tmp/${s}"
		docker exec test chmod +x "/tmp/${s}"
	done
	[ -f "${SCRIPT_DIR}/workbench.lic" ] && docker cp "${SCRIPT_DIR}/workbench.lic" test:/tmp/workbench.lic >/dev/null || true
	[ -f "${SCRIPT_DIR}/connect.lic" ] && docker cp "${SCRIPT_DIR}/connect.lic" test:/tmp/connect.lic >/dev/null || true
}

cmd_up() {
	wb_detect_arch
	export ARCH_SUFFIX="${WB_ARCH}"
	wb_bootstrap_env
	wb_compose up -d
	echo "Waiting for containers to become healthy..."
	until wb_stack_up; do sleep 1; done
	wb_fetch_scripts
	if wb_installed && [ "${1:-}" != "--reinstall" ]; then
		echo "Stack already up with Positron + Workbench installed. (Use --reinstall to change versions, 'overlay' for source.)"
		cmd_status
		return 0
	fi
	cmd_install "$@"   # defined in Task 4
}

cmd_stop() { wb_compose stop; echo "Paused (volumes preserved). Resume with: npm run wb"; }
cmd_down() { wb_compose down; echo "Stack torn down. Next 'npm run wb' will reinstall."; }

main() {
	local sub="${1:-up}"; shift || true
	case "$sub" in
		up)      cmd_up "$@" ;;
		status)  cmd_status "$@" ;;     # Task 6
		report)  cmd_report "$@" ;;     # Task 6
		logs)    cmd_logs "$@" ;;       # Task 6
		test)    cmd_test "$@" ;;       # Task 6
		overlay) cmd_overlay "$@" ;;    # Task 5
		restart) cmd_restart "$@" ;;    # Task 5
		stop)    cmd_stop ;;
		down)    cmd_down ;;
		-h|--help) echo "Usage: workbench-local.sh [up|status|report|logs|test|overlay|restart|stop|down]" ;;
		*) echo "Unknown subcommand: $sub" >&2; exit 1 ;;
	esac
}
main "$@"
```

Note: `cmd_install`, `cmd_status`, `cmd_report`, `cmd_logs`, `cmd_test`, `cmd_overlay`, `cmd_restart` are added in later tasks. To let this skeleton run for `--help` / dispatch testing before then, add temporary stubs at the top of `main` only if executing Task 3 in isolation; they are replaced in Tasks 4-6.

- [ ] **Step 3: Verify dispatch and help work**

Run: `bash dockerfiles/workbench-local.sh --help`
Expected: prints the usage line, exit 0.

Run: `bash dockerfiles/workbench-local.sh bogus; echo "exit=$?"`
Expected: `Unknown subcommand: bogus` and `exit=1`.

- [ ] **Step 4: Verify shellcheck is clean**

Run: `shellcheck dockerfiles/workbench-local.sh dockerfiles/workbench-local-lib.sh || true`
Expected: no errors (warnings about sourced files are acceptable; fix any genuine errors).

- [ ] **Step 5: Commit**

```bash
git add dockerfiles/workbench-local.sh dockerfiles/.env.example
git commit -m "feat(wb-local): orchestrator skeleton with dispatch, env bootstrap, re-entry"
```

---

### Task 4: Version pickers + install wiring

**Files:**
- Modify: `dockerfiles/workbench-local.sh` (add `cmd_install`, `wb_pick_positron`, `wb_pick_workbench`)

**Interfaces:**
- Consumes: resolver functions (Task 2); `wb_fetch_scripts` already copied `install-workbench.sh` into `test:/tmp`.
- Produces: `cmd_install [--reinstall] [--credentials=...]` which sets `WB_URL`, `POSITRON_TAG` (empty for "local"), runs `install-workbench.sh` in the container, and on "local" defers Positron to `cmd_overlay` (Task 5).

- [ ] **Step 1: Add the pickers and install function**

Add to `dockerfiles/workbench-local.sh` (above `main`):
```bash
# Sets POSITRON_TAG (empty => latest/local). Sets WB_SOURCE_LOCAL=1 for source build.
wb_pick_positron() {
	echo "Select Positron build:" >&2
	local i=1 tags=() lines
	lines="$(wb_list_positron_releases 5)"
	while IFS=$'\t' read -r tag date; do
		[ -n "$tag" ] || continue
		echo "  $i) $tag   ($date)" >&2; tags+=("$tag"); i=$((i+1))
	done <<< "$lines"
	echo "  $i) Local source build (current repo)" >&2
	local choice; read -r -p "Choice [1]: " choice; choice="${choice:-1}"
	if [ "$choice" = "$i" ]; then
		WB_SOURCE_LOCAL=1; POSITRON_TAG=""
	else
		WB_SOURCE_LOCAL=0; POSITRON_TAG="${tags[$((choice-1))]}"
	fi
	export POSITRON_TAG WB_SOURCE_LOCAL
}

# Sets WB_URL.
wb_pick_workbench() {
	echo "Select Workbench version:" >&2
	echo "  1) Stable (latest released)" >&2
	echo "  2) Daily (latest preview)" >&2
	echo "  3) Custom .deb URL" >&2
	local choice; read -r -p "Choice [1]: " choice; choice="${choice:-1}"
	case "$choice" in
		1) WB_URL="$(wb_resolve_stable_url "${WB_ARCH}")" ;;
		2) WB_URL="$(wb_resolve_daily_url "${WB_ARCH}")" ;;
		3) read -r -p "Workbench .deb URL: " WB_URL ;;
		*) echo "Invalid choice" >&2; return 1 ;;
	esac
	export WB_URL
}

cmd_install() {
	[ -n "${GITHUB_TOKEN:-}" ] || { echo "GITHUB_TOKEN is required (export it first)." >&2; exit 1; }
	local creds=""
	for a in "$@"; do case "$a" in --credentials=*) creds="$a" ;; esac; done
	wb_pick_workbench
	wb_pick_positron
	echo "Installing Workbench from: ${WB_URL}"
	echo "Positron: ${POSITRON_TAG:-${WB_SOURCE_LOCAL:+LOCAL SOURCE}${WB_SOURCE_LOCAL:-LATEST}}"
	docker exec -it \
		-e GITHUB_TOKEN="${GITHUB_TOKEN}" \
		-e WB_URL="${WB_URL}" \
		-e POSITRON_TAG="${POSITRON_TAG}" \
		-e ARCH_SUFFIX="${WB_ARCH}" \
		-e WB_PASSWORD="${WB_PASSWORD}" \
		test /bin/bash -c "/tmp/install-workbench.sh ${creds}"
	if [ "${WB_SOURCE_LOCAL:-0}" = "1" ]; then
		echo "Overlaying local source build..."
		cmd_overlay
	fi
	cmd_status
}
```

- [ ] **Step 2: Manual verification (released combo)**

Prereq: `docker login ghcr.io`, `GITHUB_TOKEN` exported, `gh auth status` OK, `workbench.lic` in `dockerfiles/`.

Run: `GITHUB_TOKEN=$GITHUB_TOKEN bash dockerfiles/workbench-local.sh`
Pick Workbench `1` (Stable), Positron `1` (newest release).
Expected: containers come up, install runs, ends with status showing both versions and `http://localhost:8787`. Log in as `user1` -> Positron session launches.

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/workbench-local.sh
git commit -m "feat(wb-local): version pickers and install wiring"
```

---

### Task 5: Local source build (`overlay`) + `restart`

**Files:**
- Modify: `dockerfiles/workbench-local.sh` (add `cmd_overlay`, `cmd_restart`)

**Interfaces:**
- Consumes: `POSITRON_ARCH` (Task 2); a running `test` container with Workbench installed (Task 4).
- Produces: `cmd_overlay` (gulp build in current repo -> docker cp -> replace `positron-server/new` -> restart) and `cmd_restart` (server restart only).

- [ ] **Step 1: Add overlay and restart functions**

Add to `dockerfiles/workbench-local.sh` (above `main`):
```bash
cmd_restart() { docker exec test bash -c 'sudo rstudio-server restart'; echo "rstudio-server restarted."; }

cmd_overlay() {
	wb_detect_arch
	local build_dir="${REPO_ROOT}/../vscode-reh-web-pwb-linux-${POSITRON_ARCH}"
	echo "Building Positron server from source (gulp vscode-reh-web-pwb-linux-${POSITRON_ARCH})..."
	( cd "${REPO_ROOT}" && npm run gulp "vscode-reh-web-pwb-linux-${POSITRON_ARCH}" )
	[ -d "${build_dir}" ] || { echo "Expected build output at ${build_dir}" >&2; exit 1; }
	echo "Overlaying into container..."
	tar -C "$(dirname "${build_dir}")" -czf /tmp/positron-custom.tar.gz "vscode-reh-web-pwb-linux-${POSITRON_ARCH}"
	docker cp /tmp/positron-custom.tar.gz test:/tmp/positron-custom.tar.gz
	docker exec test /bin/bash -c "
		cd /tmp &&
		tar -xzf positron-custom.tar.gz &&
		rm -rf /usr/lib/rstudio-server/bin/positron-server/new &&
		cp -r vscode-reh-web-pwb-linux-${POSITRON_ARCH} /usr/lib/rstudio-server/bin/positron-server/new &&
		chown -R rstudio-server:rstudio-server /usr/lib/rstudio-server/bin/positron-server/new &&
		sudo rstudio-server restart
	"
	echo "Source build overlaid. Reload http://localhost:8787"
}
```

- [ ] **Step 2: Manual verification (source inner loop)**

Prereq: a built Positron repo (`npm install` done) and a running stack with Workbench installed.

Run: `bash dockerfiles/workbench-local.sh overlay`
Expected: gulp builds `../vscode-reh-web-pwb-linux-<POSITRON_ARCH>`, it is copied in and replaces `.../positron-server/new`, server restarts. Reloading `:8787` and starting a session reflects the local build (verify via a visible source change or build number in Help > About).

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/workbench-local.sh
git commit -m "feat(wb-local): overlay subcommand for local source builds"
```

---

### Task 6: Utility subcommands (`status`, `report`, `logs`, `test`)

**Files:**
- Modify: `dockerfiles/workbench-local.sh` (add `cmd_status`, `cmd_report`, `cmd_logs`, `cmd_test`, `wb_versions`)

**Interfaces:**
- Consumes: a (possibly partial) running stack.
- Produces: `cmd_status` (doctor), `cmd_report` (paste-able snippet), `cmd_logs [service]`, `cmd_test [grep]`. Helper `wb_versions` echoes `WB_VER<TAB>POSITRON_VER`.

- [ ] **Step 1: Add the utility functions**

Add to `dockerfiles/workbench-local.sh` (above `main`):
```bash
wb_versions() {
	local wb pos
	wb="$(docker exec test bash -c 'rstudio-server version 2>/dev/null | head -1 | awk "{print \$1}"' 2>/dev/null || true)"
	pos="$(docker exec test bash -c '
		d=/usr/lib/rstudio-server/bin/positron-server/new
		if [ -f "$d/product.json" ]; then
			v=$(grep positronVersion "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
			b=$(grep positronBuildNumber "$d/product.json" | sed "s/.*: *\"\([^\"]*\)\".*/\1/")
			echo "${v}-${b}"
		fi' 2>/dev/null || true)"
	printf '%s\t%s\n' "${wb:-not installed}" "${pos:-not installed}"
}

cmd_status() {
	echo "=== Workbench Local Status ==="
	if ! wb_stack_up; then echo "Containers: not running. Start with: npm run wb"; return 0; fi
	docker ps --format '  {{.Names}}: {{.Status}}' | grep -E 'test|postgres|connect' || true
	local v; v="$(wb_versions)"
	echo "  Workbench: $(echo "$v" | cut -f1)"
	echo "  Positron:  $(echo "$v" | cut -f2)"
	echo "  Access:    http://localhost:8787 (user1 / WB_PASSWORD)   Connect: http://localhost:3939"
	docker exec test bash -c 'rstudio-server status >/dev/null 2>&1' || echo "  NOTE: rstudio-server not running -- try: npm run wb restart"
}

cmd_report() {
	local v; v="$(wb_versions)"; wb_detect_arch
	cat <<EOF
Environment:
- Positron: $(echo "$v" | cut -f2)  (under Workbench)
- Workbench: $(echo "$v" | cut -f1)
- Arch: POSITRON_ARCH=${POSITRON_ARCH}, WB_ARCH=${WB_ARCH}
- Containers: $(docker ps --format '{{.Names}}={{.Status}}' | grep -E 'test|postgres|connect' | paste -sd', ' -)
EOF
}

cmd_logs() {
	case "${1:-rserver}" in
		rserver|workbench) docker exec test bash -c 'tail -n 100 -f /var/log/rstudio/rstudio-server/rserver.log' ;;
		connect)           docker logs -f connect ;;
		*)                 docker logs -f "${1}" ;;
	esac
}

cmd_test() {
	local grep_arg="${1:-}"
	( cd "${REPO_ROOT}" && npx playwright test --project e2e-workbench ${grep_arg:+--grep "$grep_arg"} )
}
```

- [ ] **Step 2: Verify status against a down stack**

Run (with no containers up): `bash dockerfiles/workbench-local.sh status`
Expected: `Containers: not running. Start with: npm run wb`, exit 0.

- [ ] **Step 3: Manual verification against a live stack**

With a stack up + installed:
Run: `bash dockerfiles/workbench-local.sh status` -> shows both versions + URLs.
Run: `bash dockerfiles/workbench-local.sh report` -> prints a paste-able block with versions, arch tokens, container states.

- [ ] **Step 4: Commit**

```bash
git add dockerfiles/workbench-local.sh
git commit -m "feat(wb-local): status, report, logs, and test subcommands"
```

---

### Task 7: `npm run wb` + workspace task buttons + docs

**Files:**
- Modify: `package.json` (add `wb` script)
- Create: `positron.workbench.code-workspace`
- Create: `dockerfiles/README-workbench-local.md`

**Interfaces:**
- Consumes: all subcommands from Tasks 3-6.
- Produces: `npm run wb` entry point; clickable tasks; setup docs.

- [ ] **Step 1: Add the npm script**

In `package.json` `scripts`, add (keep alphabetical-ish placement near other tooling scripts; tabs for indentation):
```json
		"wb": "bash dockerfiles/workbench-local.sh",
```

- [ ] **Step 2: Verify the npm alias dispatches**

Run: `npm run wb -- --help`
Expected: prints the usage line.

- [ ] **Step 3: Create the workspace with task buttons**

Create `positron.workbench.code-workspace`:
```json
{
	"folders": [{ "path": "." }],
	"settings": {},
	"tasks": {
		"version": "2.0.0",
		"tasks": [
			{ "label": "WB: Up (pick versions)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh", "problemMatcher": [] },
			{ "label": "WB: Status (doctor)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh status", "problemMatcher": [] },
			{ "label": "WB: Report (for bug)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh report", "problemMatcher": [] },
			{ "label": "WB: Overlay source build", "type": "shell", "command": "bash dockerfiles/workbench-local.sh overlay", "problemMatcher": [] },
			{ "label": "WB: Restart server", "type": "shell", "command": "bash dockerfiles/workbench-local.sh restart", "problemMatcher": [] },
			{ "label": "WB: Run @:workbench tests", "type": "shell", "command": "bash dockerfiles/workbench-local.sh test @:workbench", "problemMatcher": [] },
			{ "label": "WB: Logs (rserver)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh logs", "problemMatcher": [] },
			{ "label": "WB: Stop (pause)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh stop", "problemMatcher": [] },
			{ "label": "WB: Down (teardown)", "type": "shell", "command": "bash dockerfiles/workbench-local.sh down", "problemMatcher": [] },
			{ "label": "WB: Open Workbench (:8787)", "type": "shell", "command": "open http://localhost:8787 || xdg-open http://localhost:8787", "problemMatcher": [] }
		]
	}
}
```

- [ ] **Step 4: Write the setup doc**

Create `dockerfiles/README-workbench-local.md`:
```markdown
# Local Workbench QA (`npm run wb`)

Bring up Workbench + a chosen Positron build in one command.

## Prerequisites
- `docker login ghcr.io` with a PAT (`read:packages` scope)
- `export GITHUB_TOKEN=<pat>` (used for positron-builds + image pulls)
- `gh auth login` (for the Positron release list)
- Docker Desktop: 8+ CPU, 16 GB RAM
- License files: place `workbench.lic` and `connect.lic` in `dockerfiles/`
- `.env`: auto-created from `.env.example` on first run; you'll be prompted for `WB_PASSWORD` if unset

## Usage
- `npm run wb` -- up + pick Positron (last 5 releases or local source) + pick Workbench (stable/daily/custom)
- `npm run wb -- status` -- doctor: containers, versions, URLs
- `npm run wb -- report` -- paste-able environment block for bug reports
- `npm run wb -- overlay` -- rebuild current source + overlay into Workbench (fast inner loop)
- `npm run wb -- test @:workbench` -- run e2e against the live stack
- `npm run wb -- stop` -- pause (volumes preserved); `npm run wb -- down` -- tear down
- Or open `positron.workbench.code-workspace` and use the task buttons.

## First-login "Forbidden"
If `http://localhost:8787` shows Forbidden, clear the `vscode-tkn` cookie for `localhost` and refresh.

## Known limits
- One stack at a time (`container_name: test`). Comparing two WB versions = `down` then bring up the other.
- On Apple Silicon the Connect service runs emulated (amd64) and starts slowly.
```

- [ ] **Step 5: Verify the workspace JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('positron.workbench.code-workspace','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add package.json positron.workbench.code-workspace dockerfiles/README-workbench-local.md
git commit -m "feat(wb-local): npm run wb entry point, workspace buttons, and docs"
```

---

## Self-Review Notes

- **Spec coverage:** one-command up (Task 3-4), two pickers (Task 4 + resolvers Task 2), local source/overlay (Task 5), status/report/logs/test/restart/stop/down (Tasks 3,5,6), compose arch (Task 1), workspace veneer + docs + prereqs incl. license placement (Task 7), prerelease note (Task 2 lib + Global Constraints), re-entry (Task 3). All spec sections map to a task.
- **Arch token consistency:** `POSITRON_ARCH` used only for gulp/artifact names (Tasks 2,5); `WB_ARCH`/`ARCH_SUFFIX` only for deb/image/install (Tasks 1,2,4). No bare `<arch>`.
- **Integration contract:** pickers set exactly `WB_URL` / `POSITRON_TAG` / `ARCH_SUFFIX` consumed by `install-workbench.sh` (verified against the script).
- **Testing proportionality:** automated fixture tests only for the pure resolvers (Task 2); docker/interactive paths use explicit manual-verification steps -- matches the spec's testing section.
