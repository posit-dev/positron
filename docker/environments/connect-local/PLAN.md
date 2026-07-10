# Plan: Run Connect / Publisher e2e tests without Workbench

## Goal

Let the publisher/connect e2e tests run and be debugged **locally** against a
standalone Posit Connect container (plain local Positron desktop, no Workbench),
while keeping them running under the existing Workbench CI (which provides the
**web/chromium** coverage). Delivered in two PRs.

This doc is self-contained: an implementer should not need the originating chat.

---

## Background: current state

- The two tests are `test/e2e/tests/workbench/publisher/publisher-quarto-r.test.ts`
  and `publisher-shiny.test.ts`. Both tagged `[tags.WORKBENCH, tags.PUBLISHER]`.
- Connect runs as a service in the Workbench compose files
  (`docker/environments/wb-local/docker-compose.ubuntu24.yml` for local,
  `docker/environments/workbench-dev/docker-compose.workbench.yml` for CI).
- The Connect API token is bootstrapped by `ensure_connect_token()` inside
  `docker/environments/wb-local/install-workbench.sh` (lines ~136-183). It runs
  `rsconnect bootstrap --server http://connect:3939 --raw`, writes the result to
  `/tokens/connect_bootstrap_token` (a shared docker volume `connect_tokens`).
- Tests read the token via `docker exec test bash -lc 'cat /tokens/connect_bootstrap_token'`.
- Tests target the publisher deploy at `http://connect:3939` (the credential URL,
  resolved via docker network inside the container where the publisher runs) and
  hit the Connect API at `http://localhost:3939` (published port, from host test code).

## Key mechanisms this plan relies on (verified)

1. **Playwright project-level `testIgnore` REPLACES the global `baseIgnore`; it does
   not merge.** Proof: `e2e-electron` re-lists the entire ignore set, and
   `e2e-workbench` omits `**/workbench/**` (that omission is exactly how it runs the
   workbench tests despite the global ignore). Location: root `playwright.config.ts`.
2. **The merge and full-suite runs use `grep: ""`** (`.github/workflows/test-merge.yml`,
   `test-full-suite.yml`), so tags do NOT gate them -- only a project's path
   `testIgnore` does. Directory isolation is the ONLY reliable protection from the
   connect-less electron merge run.
3. **`CONNECT_API_KEY` is already taken** -- it is the metrics/insights Connect key
   (`test/e2e/utils/metrics/metric-base.ts`), a different server. Use
   `CONNECT_PUBLISHER_API_KEY` (or a token-file path) for the publisher token.
4. **Three places copy scripts into the `test` container**, each with an explicit
   per-file list. Any newly extracted script MUST be added to all three or the
   Workbench run breaks at bootstrap:
   - `docker/environments/wb-local/connect.sh` (~line 84, `for script in ...`)
   - `docker/environments/workbench-dev/workbench-local.sh` (~line 12, `WB_SCRIPTS=(...)`)
   - `.github/actions/setup-workbench-docker/action.yml` (~lines 66-80, `docker cp` + `chmod`)
5. **`test-tag-paths-map.json` keys off `src/` source paths only** -- moving test
   files does NOT shift PR tag selection.

## Coverage model (post-implementation)

| Surface          | Project             | Requires Workbench? |
|------------------|---------------------|---------------------|
| Electron desktop | `e2e-connect` (new) | No (local + PR2 CI) |
| Web / chromium   | `e2e-workbench`     | Yes (existing)      |

`@:workbench` is kept **permanently** -- it is the web coverage, complementary to
the electron-only `e2e-connect`. A standalone connect-web project (`e2e-connect-web`,
chromium against a Positron server) is intentionally NOT built now; add later only
if a connect-web issue must be reproduced without Workbench.

---

## PR 1 -- Decouple + local-runnable (no new CI workflow)

### 1. Move the tests
`test/e2e/tests/workbench/publisher/` -> `test/e2e/tests/connect/`
(both test files).

### 2. `playwright.config.ts`
- Add `'**/connect/**'` to `baseIgnore` AND to the `e2e-electron` project's own
  `testIgnore` (replaces the protection `**/workbench/**` provided -- keeps them off
  the connect-less merge/full-suite electron run).
- Add a new `e2e-connect` project, copied from `e2e-workbench` but plain local
  electron: `useExternalServer: false`, its own `testIgnore` that does NOT list
  `**/connect/**`, `grep: /@:connect/`.
- DO NOT add `**/connect/**` to the `e2e-workbench` project's `testIgnore` -- that
  omission is what keeps the web coverage running the moved files.

### 3. Tagging
- Add a `CONNECT` tag (`@:connect`) to `test/e2e/infra/test-runner/test-tags.ts`.
- Retag both tests: `[tags.WORKBENCH, tags.CONNECT, tags.PUBLISHER]`.
- DO NOT tag `@:critical`.

### 4. Token handling (the "factor out")
- Extract `ensure_connect_token` from `install-workbench.sh` into standalone
  `docker/environments/wb-local/ensure-connect-token.sh`, parameterized on output
  location (not hard-coded `/tokens`).
- Have `install-workbench.sh` source/call it.
- Add the new script to all THREE copy lists (see mechanism #4 above) with cp + chmod.
- In the tests, replace the inline `docker exec test cat /tokens/...` block with a
  shared resolver (put it on the Connect page object, `test/e2e/pages/connect.ts`)
  that tries, in order:
  1. `process.env.CONNECT_PUBLISHER_API_KEY`
  2. local token file (path from env or a known local location)
  3. `docker exec test cat /tokens/connect_bootstrap_token` (existing Workbench
     fallback -- KEEP so the Workbench run still validates this branch)

### 5. Local connect-only compose
- New `docker/environments/connect-local/docker-compose.yml`: just the `connect`
  service (copy from wb-local compose), the two config mounts
  (`rstudio-connect.gcfg`, `connect.lic`), port 3939, and a **persistent
  `connect-data` volume** (stable key -> keychain credential stays valid across runs).
- Local token bootstrap: a **one-shot container** in this compose (a `token`
  service / compose profile) that runs `ensure-connect-token.sh` against connect and
  writes the token to a **bind-mounted local file** the resolver reads. (Avoids a
  host `rsconnect` dependency.)
- Copy the two connect config files into `connect-local/connect/` (or reference the
  wb-local ones).
- Doc: instruct adding `127.0.0.1 connect` to `/etc/hosts` so the publisher's stored
  `connect:3939` credential resolves on the host. Keep the stored credential URL as
  `connect:3939` in both modes so the same keychain entry works everywhere.

### 5a. npm scripts (mirror the `wb:*` convention)
Add to root `package.json`, following the existing `wb:start` / `wb:stop` /
`wb:status` pattern (each `cd`s into the env dir and runs a wrapper script):
- `connect:start` -> `bash -c "cd docker/environments/connect-local && ./run.sh"`
  (compose up connect + run the one-shot token bootstrap; writes the local token file)
- `connect:stop` -> `bash -c "cd docker/environments/connect-local && ./stop-containers.sh"`
- `connect:status` (optional) -> reports whether connect is reachable + token present
- `connect:token` (optional) -> prints the current local token path/value for debugging

Provide the matching `run.sh` / `stop-containers.sh` (and optional `status.sh`) in
`docker/environments/connect-local/`, modeled on the wb-local equivalents. Note the
naming nuance: `wb:connect` means "attach to the Workbench container", whereas
`connect:*` refers to the Posit Connect product environment -- keep them distinct.

### 6. Robustness (keychain footgun)
- In the local `beforeAll`, after obtaining the fresh key, do an authenticated
  Connect API ping; if a saved `connect-container` credential exists but the key is
  stale (volume was wiped), clear that one keychain entry and re-enter. Self-heals a
  deleted volume. Gate to local mode.
- Add `test.skip()` when connect is unreachable, so running the full local suite
  without connect up does not produce spurious failures.

### PR 1 verification
- Local: `npx playwright test --project e2e-connect test/e2e/tests/connect/publisher-quarto-r.test.ts`
  against the connect-local compose -> passes. Exercises the env/local-file token branch.
- Workbench CI safety net: tag the PR so the Workbench job runs; confirms moved files
  + extracted script + `docker exec` token branch still green (this is also the web
  coverage).
- NOT covered here (deferred to PR 2): `e2e-connect` unattended in CI, connect-only
  compose in CI.

---

## PR 2 -- Dedicated CI workflow (electron only)  [IMPLEMENTED]

### Changes (as built)
- New `.github/workflows/test-e2e-connect.yml`, `ubuntu-latest-8x` runner.
  - **Structural model: `test-e2e-remote-ssh-ubuntu.yml`, not `test-e2e-ubuntu-run.yml`.**
    Reason: `e2e-connect` must run docker compose on the host to stand up Connect
    with bind-mounted gcfg/license (the `services:` limitation the plan called out),
    and it needs the electron app + interpreters on that same host so
    `localhost:3939` / the `connect` hostname resolve for both the app and the
    published port. remote-ssh already does exactly this (plain host + `docker` +
    a DEB-installed electron Positron); ubuntu-run runs inside the
    `positron-ubuntu24` container where host docker/networking is not available.
  - Depends on a Positron electron BUILD artifact: new
    `.github/workflows/build-connect-linux.yml` builds a plain Positron DEB
    (`positron-deb-connect-x64`, a trimmed copy of build-remote-ssh's DEB job --
    no REH). The run workflow installs it with `dpkg -i` and runs electron with
    `BUILD=/usr/share/positron`.
  - Brings Connect up via the PR-1 connect-local compose in a step AFTER checkout
    by calling `docker/environments/connect-local/run.sh` (same path as local),
    then exports `CONNECT_PUBLISHER_API_KEY` from the bootstrapped token file
    (read with `sudo` -- the one-shot token container writes it root-owned 0600).
  - Writes `connect/connect.lic` from the `CONNECT_LICENSE` 1Password secret
    (mirrors the Workbench workflow's license step) before `run.sh`.
  - Installs interpreters on the host (R via rig, Python via setup-python, Quarto
    via quarto-actions) -- mirrors `test-e2e-macos-run.yml`, since the electron
    app runs on the host. **This is the most likely area to need iteration.**
  - Adds `127.0.0.1 connect` to `/etc/hosts`, xvfb, then
    `npx playwright test --project e2e-connect` (the project's own `grep`
    scopes to `@:connect`).
- Wired into `test-pull-request.yml`: `build-connect` + `e2e-connect` jobs gated
  on `connect_tag_found` (build -> e2e via `needs`), mirroring the
  build-remote-ssh -> e2e-remote-ssh pair.
- `scripts/pr-tags-parse.sh` now sets `connect_tag_found=true` when the PR body
  contains `@:connect` (word-boundary match so it does NOT fire on
  `@:connections`); `pr-tags` job exposes it as an output.

### Deviations from the original plan text
- Runner is `ubuntu-latest-8x` (plain host) modeled on remote-ssh, not the
  container-based `test-e2e-ubuntu-run.yml` -- see reason above. The plan's intent
  (host + docker compose + downloaded electron build, NOT `services:`) is honored.
- Single job (2 tests), no sharding / merge-reports -- unnecessary here and
  keeps the non-blocking lane simple.

### Gotchas
- Connect image is `linux/amd64` -- native on the amd64 runner (no emulation), but
  bootstrap/reachability timing still needs generous waits (run.sh already waits).
- Host interpreter install (R packages via PPM snapshot, system libs like
  libgdal/libudunits) is the fragile part; expect to tune versions/deps.
- `@:connect` lives in FeatureTags, so it is also auto-added to the default
  electron lane's grep, but the `e2e-electron` project ignores `**/connect/**`,
  so the connect tests do not double-run there. Only an explicit `@:connect` in
  the PR body triggers this dedicated lane.
- DO NOT wire this into `test-merge.yml` / `test-full-suite.yml` as a gate until it
  has had several green runs. New, non-blocking first.

### PR 2 verification
- Tag a PR `@:connect` -> `build-connect` + `e2e-connect` run; iterate until green
  several times unattended; then optionally add it as a job to merge/full-suite.

### PR 2 CI bring-up -- first green (run 29126155881, 2026-07-10)
`build-connect` + `e2e-connect` both green; only the two publisher tests ran:
`publisher-quarto-r` (2.5m) and `publisher-shiny` (1.0m), 2 passed / 0 failed.
Three fixes were needed after the first attempts (all in this PR):
1. Dropped job-level `R_LIBS_SITE`/`R_LIBS_USER` -- they overrode rig-managed R's
   library path so the freshly-installed `pak` was invisible. (rig-based macOS run
   sets neither; remote-ssh sets them only because its R runs in the container.)
2. `PPM_REPO` -> noble (24.04) binary repo (was jammy); matches the runner and
   rig's ubuntu-2404 R.
3. `playwright.config.ts` e2e-connect project `grep: /@:connect/` -> `/@:connect(?![\w-])/`.
   The bare regex substring-matched `@:connections`, dragging the Postgres/Snowflake
   connections suite into the Connect-only lane. (Locally masked because the README
   command passes a `test/e2e/tests/connect/` path; CI runs the project without a path.)

Known non-fatal noise: the run logs `API failed after 3 attempts: HTTP 401` from the
metrics/insights reporter (this lane sets no `CONNECT_API_KEY`/reporter creds); it does
not affect pass/fail. Clean up later if desired.

Watch-outs when writing the PR description: the PR-tag parser (pr-tags-parse.sh) and
the Playwright project grep BOTH scan for tag literals as substrings, so writing
`@:workbench`/`@:connections` in prose triggers those lanes / suites. Keep tag
literals out of prose (or the body will spin up the Workbench build).

---

## Locked decisions
- Local bootstrap: one-shot container writing to a bind-mounted token file (no host
  `rsconnect`).
- Keep `@:workbench` permanently (web coverage; complementary to electron `e2e-connect`).
- Connect CI workflow is electron-only; no `e2e-connect-web` project for now.
- Add `connect:start` / `connect:stop` (+ optional `connect:status` / `connect:token`)
  npm scripts mirroring the `wb:*` convention.
