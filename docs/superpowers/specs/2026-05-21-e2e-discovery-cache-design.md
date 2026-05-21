# E2E Test Discovery Cache Seeding

**Status:** Draft
**Author:** Marie Idleman
**Date:** 2026-05-21
**Related:** [PR #13291](https://github.com/posit-dev/positron/pull/13291) (Cache previously discovered runtimes)

## Background

PR #13291 introduced a runtime discovery cache that dramatically reduces cold-start time for users by remembering which Python and R interpreters live on a machine across Positron sessions. The cache is keyed by `(extensionId, languageId, runtimePath)` and validated by `(size, mtime, ctime)` fingerprints. On a typical warm start with nothing changed on disk, the `Discovering` startup phase reduces from many seconds (sometimes minutes in customer environments) to a few stat calls.

E2E tests do not reap this benefit. Each test launches Positron with a fresh `--user-data-dir` (via `getRandomUserDataDir()` in `test/e2e/fixtures/test-setup/options.fixtures.ts`), and the cache lives in that directory's `state.vscdb`. Every test pays the full discovery cost on launch.

The cost in CI is multiplicative: discovery runs once per test, once per worker, once per shard, once per platform. Across the full e2e matrix (Linux/Windows/macOS × Electron/web × multiple shards), reclaiming the cache for tests is a meaningful wall-clock win on the slowest part of the pipeline.

## Goals

- E2E tests skip interpreter discovery on launch by reusing a primed cache.
- Zero behavior change for production users.
- Minimal new surface area in the cache service.
- One discovery pass per CI workflow, not per shard.
- Same mechanism works locally for developers running e2e tests on their machine.

## Non-goals

- Caching anything besides runtime discovery.
- Sharing the cache between unrelated workflows, between developers, or across CI runs without an explicit cache key.
- Changing how the cache works for production users.
- Eliminating discovery entirely — the cache still requires a real discovery pass to populate it.

## Solution overview

Add a single environment variable, `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED`, that points at a JSON file. On startup, if the env var is set, the cache service imports the file's contents into `IStorageService` under the existing cache key — but only if that key is not already populated. After import, the cache service behaves identically to today.

A new test infrastructure script primes the file by launching Positron, waiting for discovery to complete, and dumping the cache row from `state.vscdb`. In CI, each e2e shard adds an inline step backed by `actions/cache`: on cache hit (the common case) the seed restores in ~5s and prime is skipped; on cache miss (Dockerfile or interpreter-install changes), parallel shards each run prime, and `actions/cache@v5` idempotently saves the result so the next workflow gets a hit.

The change is gated end-to-end:
- Env var unset → code path is dead → identical to today.
- File missing/malformed → seeding is skipped, log a warning → identical to today.
- Storage key already populated → seeding is skipped → user's real cache wins.
- Stale fingerprints in the seed → existing per-entry fingerprint check evicts or revalidates → identical to today's first-launch behavior on the affected entries.

The worst-case outcome on any failure is the status quo. The best case is that discovery is skipped on every e2e launch after the first prime.

## Architecture

Four components, each in its own layer:

```
┌─────────────────────────────────────────────────────────────┐
│ Component 1: Production (RuntimeDiscoveryCacheService)      │
│  - Seed import on startup (env var → file → IStorageService)│
│  - Export API: exportCacheState() returns JSON-serializable │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ in-process API
                              │
┌─────────────────────────────────────────────────────────────┐
│ Component 2: CLI export flag (shared primitive)             │
│ --export-discovery-cache=PATH: boot, wait Complete, dump    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ shell invocation
                              │
┌─────────────────────────────────────────────────────────────┐
│ Component 3: Test infra                                     │
│ Prime script (wraps CLI) + launch fixture env var injection │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ artifact / local file
                              │
┌─────────────────────────────────────────────────────────────┐
│ Component 4: CI workflow                                    │
│ Inline prime step in each shard, backed by actions/cache    │
└─────────────────────────────────────────────────────────────┘
```

Each layer has a single, narrow purpose. Each can be developed and tested in isolation. Components 1 and 2 are **shared primitives** that Posit Workbench can reuse for its own server-wide cache priming; Components 3 and 4 are e2e-specific consumers.

## Component 1: Production change

**Location:** `src/vs/workbench/services/runtimeStartup/common/runtimeDiscoveryCache.ts` (the implementation file; `runtimeDiscoveryCacheService.ts` is the interface).

Two additions to the cache service: a seed-import code path that runs on startup, and an `exportCacheState()` method that returns the cache contents in a JSON-serializable form.

### 1a. Seed import on startup

Add seed-import logic to the service initialization. Pseudocode:

```ts
private maybeImportSeed(): void {
    const seedPath = process.env.POSITRON_RUNTIME_DISCOVERY_CACHE_SEED;
    if (!seedPath) {
        return;
    }
    if (this._storageService.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION)) {
        // Don't clobber an existing cache — local dev with real Positron state should win.
        return;
    }
    let raw: string;
    try {
        raw = fs.readFileSync(seedPath, 'utf8');
    } catch (e) {
        this._logService.warn(`[discoveryCache] seed file unreadable: ${e}`);
        return;
    }
    try {
        JSON.parse(raw); // validate shape before storing
    } catch (e) {
        this._logService.warn(`[discoveryCache] seed file malformed: ${e}`);
        return;
    }
    this._storageService.store(
        RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
        raw,
        StorageScope.APPLICATION,
        StorageTarget.MACHINE,
    );
    this._logService.info(`[discoveryCache] seeded from ${seedPath}`);
}
```

Called once from the constructor, before any read of the cache key.

**Why this shape:**
- Reads the env var inside the service (not threaded through constructor injection). The env var is process-global and only consulted on startup; constructor injection adds plumbing for no benefit.
- Validates JSON shape before storing, so a corrupt file can't poison the SQLite row.
- "Don't clobber" rule means seeding is purely additive — a developer running tests locally with a real cache won't have it overwritten by a stale seed.

**Why no `cacheable` field changes, no new settings, no telemetry:** every existing mechanism (fingerprint validation, revalidation, eviction, the `interpreters.discoveryCache.enabled` setting) keeps working unchanged. The seed is just a different starting state.

### 1b. Export API

Add a method to the `IRuntimeDiscoveryCache` interface:

```ts
/**
 * Return the current cache state as a JSON-serializable payload.
 * The shape exactly matches what is persisted to IStorageService under
 * RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, so the export can be re-imported
 * via the POSITRON_RUNTIME_DISCOVERY_CACHE_SEED env var.
 */
exportCacheState(): IDiscoveryCachePayload;
```

The implementation reads the current in-memory cache state and returns it. No new serialization logic — `JSON.stringify(exportCacheState())` produces the exact same string that the storage row already holds. This is the in-process API that Component 2 (CLI flag) and any future caller (Workbench tooling, diagnostics) builds on.

**Why expose this as a service method instead of reading `state.vscdb` directly:**
- Reading the SQLite file from outside Positron requires a SQLite dep, hard-codes the storage layout, and breaks if VS Code changes how it persists application storage.
- A service method is decoupled from the storage backend — if the cache layer changes how it persists (e.g. to a separate file, to in-memory only for some scopes), callers don't notice.
- The same method serves diagnostics, the CLI export flag, and (eventually) Workbench tooling. One implementation, many consumers.

## Component 2: CLI export flag

**New flag:** `positron --export-discovery-cache=PATH`

**Behavior:**
1. Parse the flag during CLI argument processing.
2. App boots normally.
3. A new top-level contribution listens for the runtime startup phase to reach `Complete`.
4. On `Complete`, the contribution resolves `IRuntimeDiscoveryCache`, calls `exportCacheState()`, writes `JSON.stringify(result)` to the path, and exits with code 0.
5. On any error (write failure, timeout waiting for `Complete`), log to stderr and exit with non-zero.

**Why a CLI flag, not a command palette command:**
- Scriptable from any shell — no Electron API knowledge required.
- Works headlessly — the prime script and Workbench tooling both want to invoke this without UI interaction.
- Symmetric with the existing pattern of CLI flags for diagnostic / one-shot operations.
- Language-agnostic — Workbench's eventual integration likely runs from a shell script, not from a VS Code extension.

**Implementation location:**
- Flag declaration: wherever Positron CLI args are parsed (to be confirmed during plan-writing — likely alongside other Positron-specific CLI flags).
- Behavior contribution: a small workbench contribution that observes the startup phase and triggers the export. Lives next to the cache service in `runtimeStartup/`.

**Open question for plan-writing:** the cleanest way to signal "exit now" from a workbench contribution. May piggyback on an existing one-shot CLI mechanism (e.g. the same path that handles `--list-extensions`).

## Component 3: Test infrastructure

**New file:** `test/e2e/scripts/prime-discovery-cache.ts`

**Behavior:** a thin shell over the Component 2 CLI flag.

1. Accept `--out <path>` argument.
2. Create a temporary user-data-dir.
3. Invoke the Positron binary with `--export-discovery-cache=<out> --user-data-dir=<tmp>` plus whatever other flags the e2e launcher uses.
4. Wait for the process to exit.
5. Exit with the same code.

**Implementation notes:**
- The script is ~30 lines because all the heavy lifting (boot, wait for Complete, export, exit) happens inside Positron via Component 2.
- No SQLite dep, no `state.vscdb` knowledge in the script.
- Resolves the Positron binary path the same way the e2e launcher does (`resolveElectronConfiguration` in `test/e2e/infra/electron.ts`), so it stays in sync with how tests actually launch the app.

**New file:** `test/e2e/scripts/prime-discovery-cache.test.ts` (or inline in the test setup)

Optionally, the e2e launch fixture (`test/e2e/fixtures/test-setup/app-managed.fixtures.ts`) sets `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED` on the Electron child process if a seed file exists at a well-known path (e.g. `process.env.POSITRON_DISCOVERY_CACHE_SEED_PATH || defaultPath`). Tests don't need to know about this — if the seed exists, the env var is set; if not, tests run as today.

**Local developer workflow:**

```bash
# One-time prime (or whenever interpreters change)
npm run prime-discovery-cache

# Run e2e tests as normal — they pick up the seed automatically
npx playwright test test/e2e/tests/...
```

A `--no-cache-seed` flag (or env var) lets developers opt out for cache-related debugging.

## Component 4: CI workflow changes

**Approach:** each existing e2e shard adds an inline prime step backed by `actions/cache`. No new job, no `needs:` dependency, no upload/download artifact.

**Cache key shape:**
```
positron-discovery-${SCHEMA_VERSION}-${runner.os}-${runner.arch}-${IMAGE_HASH}-${INTERPRETER_MANIFEST_HASH}
```

Where:
- `SCHEMA_VERSION` = `RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION` constant, read from source. Bumps automatically when the cache format changes.
- `IMAGE_HASH` = container image digest for containerized runs, or `${ImageOS}-${ImageVersion}` env vars for hosted runners.
- `INTERPRETER_MANIFEST_HASH` = SHA of a known list of files that determine which interpreters get installed (Dockerfile, install scripts, setup-action versions). Exact file list to be settled in the plan.

**Steps added to each existing e2e shard:**
1. Compute cache key (one shell line).
2. `actions/cache@v5` with that key and `path: ~/.cache/positron-e2e/`. On hit, the seed file is restored. On miss, the action records the key for save-on-success.
3. If the seed file is missing after the cache step: run `npm run prime-discovery-cache -- --out ~/.cache/positron-e2e/discovery-cache.json`.
4. Set `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED=~/.cache/positron-e2e/discovery-cache.json` on the test command's environment.

On cache miss, one shard's save populates the cache for next time (`actions/cache@v5` handles parallel "already saved" gracefully — subsequent saves with the same key are no-ops).

**Cost analysis:**

| Scenario | Added per-shard wall-clock | Notes |
|---|---|---|
| PR touches only `src/` against stable container | ~5s (cache restore) | Cache hit; no prime runs |
| PR touches Dockerfile or interpreter install script | ~1-2 min (cache miss + prime) | All shards on that platform run prime in parallel; one save wins, others no-op |
| Schema version bump in source | Same as Dockerfile change | Key automatically invalidates |
| Hosted runner image bump (Windows/macOS) | Same as Dockerfile change | Only the affected platform regens |

Wall-clock impact in steady state is ~5s per shard; in exchange, each shard saves the per-test discovery cost it pays today (multiple test launches × discovery time per launch).

## Data flow

```
Each shard
  ├─ actions/cache@v5 restore
  │      ├─ HIT: seed file appears at ~/.cache/positron-e2e/discovery-cache.json
  │      └─ MISS: nothing restored; key recorded for post-job save
  │
  ├─ If seed file missing:
  │      └─ npm run prime-discovery-cache --out <path>
  │            └─ Invokes: positron --export-discovery-cache=<path> --user-data-dir=<tmp>
  │                 └─ Positron boots; discovery runs
  │                      └─ On startup phase Complete, exportCacheState() called
  │                           └─ JSON written, app exits
  │
  ├─ Set POSITRON_RUNTIME_DISCOVERY_CACHE_SEED=<path>
  │
  ├─ Run tests
  │      └─ Each test launches Positron
  │           └─ Cache service sees env var
  │                └─ Imports JSON into IStorageService
  │                     └─ Cache is warm; Discovering phase short-circuits
  │                          └─ Tests run faster
  │
  └─ Post-job: actions/cache@v5 saves seed if cache-miss path ran
            (parallel shards with the same key: first save wins, others no-op)
```

## Error handling

| Failure mode | Behavior | Test coverage |
|---|---|---|
| Env var unset | Skip seeding, no log | Unit (vitest) |
| Seed file missing | Log warning, skip seeding | Unit (vitest) |
| Seed file malformed JSON | Log warning, skip seeding | Unit (vitest) |
| Storage key already populated | Skip seeding, no log | Unit (vitest) |
| Per-entry fingerprint stale | Existing fingerprint check evicts entry | Already tested in `runtimeDiscoveryCache.vitest.ts` |
| Discovery root signature stale | Existing root-signature check triggers full discovery for that bucket | Already tested |
| Schema version mismatch | Key embeds schema version → stale seed file is unreadable at new key → behaves as if file is missing | Implicit |
| Prime step fails in one shard | That shard runs without a seed (status-quo behavior). The prime step uses `continue-on-error: true` so a script bug doesn't fail the test job. | Workflow-level |
| Prime step times out | Same as failure — shard proceeds without seed. Set a generous step `timeout-minutes` to surface chronic regressions without blocking PRs. | Workflow-level |
| Parallel shards saving the same cache key | `actions/cache@v5` is idempotent on save: first save wins, subsequent saves with same key are no-ops. No special handling needed. | n/a |

## Testing strategy

**Cache service — seed import (vitest):** Extend `src/vs/workbench/services/runtimeStartup/test/common/runtimeDiscoveryCache.vitest.ts` with cases for:
- Env var set, file present, key absent → key populated from file.
- Env var set, file present, key already populated → key untouched.
- Env var set, file missing → key untouched, no throw.
- Env var set, file malformed → key untouched, no throw.
- Env var unset → key untouched, no fs read attempted.

**Cache service — export API (vitest):** Cases for:
- Empty cache → exportCacheState returns the empty payload shape.
- Populated cache → exportCacheState returns a payload that round-trips through JSON.stringify/parse and matches the storage row exactly.
- Schema version embedded in export matches `RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION`.

**CLI export flag (integration):** A standalone test that runs `positron --export-discovery-cache=<tmp>` against a real interpreter install, verifies the output file is valid JSON matching the cache schema, and confirms the process exits 0.

**End-to-end smoke test:** One existing e2e test runs both with and without the seed env var; both should pass, the seeded one should show a log line confirming the seed was loaded. Manual verification during initial rollout, not a permanent test.

## Rollout

1. **Cache service: seed import + export API** — land first. Both new code paths are inert until something invokes them (env var unset, no CLI flag), so safe-to-merge no-op for users.
2. **CLI export flag** — land second, once the export API exists. End-to-end testable in isolation by running `positron --export-discovery-cache=<tmp>` locally and inspecting the JSON.
3. **Prime script + local workflow** — land third. Developers can opt in manually; not yet wired into CI.
4. **CI wiring (one workflow)** — land fourth, against `test-pull-request.yml` only. Verify wall-clock improvement and zero new flakes over ~1 week.
5. **Expand to remaining workflows** — `test-merge.yml`, then `positron-builds` test-release matrix.

Each step is independently revertable. If a regression appears in step 4 or 5, removing the env var from one workflow restores today's behavior with zero code change.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Bug in new seed-import code | Low | Env var-gated; dead in production. Vitest coverage. |
| Seed contains sensitive paths | Low | Seed contains interpreter binary paths and version metadata only — same content that's already in users' production caches. No credentials, no project data. |
| Prime script becomes a maintenance burden | Low | The script is a thin wrapper over `positron --export-discovery-cache` (Component 2). All non-trivial logic lives in Positron itself, where it benefits from the rest of the codebase's maintenance. |
| CLI export flag drifts from internal cache representation | Low | The flag invokes `exportCacheState()` which is a public method on the cache service. Vitest covers the round-trip (export → re-import → identical state). Workbench depending on the flag adds a second consumer that catches drift. |
| Parallel shards on cache miss waste duplicate compute | Low | Happens only on Dockerfile/install-script changes (~weekly per platform). Modest in absolute terms (~tens of runner-minutes per miss). |
| Tests start to rely on cached state in ways that hide real bugs | Medium | Document that prime represents a *clean* discovery pass, not a hand-crafted fixture. Any test that needs to validate discovery behavior itself should set the `interpreters.discoveryCache.enabled: false` setting (which already exists from PR #13291). |

## Workbench compatibility

Posit Workbench runs Positron multi-user on a shared server. Each user session today pays its own discovery cost; the team has expressed interest in a server-wide primed cache so the first user warms it for everyone. This spec doesn't design that experience, but it does provide the primitives Workbench will need:

**Shared primitives (in this spec):**
- `IRuntimeDiscoveryCache.exportCacheState()` — single in-process API for reading the cache state in a JSON-serializable form. Workbench's eventual server-side tooling calls this just like the CLI flag does.
- `positron --export-discovery-cache=PATH` — CLI flag to invoke the export headlessly. Workbench admins can wire this into a server-prime script the same way e2e does.
- `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED` env var — same env var works for "server provides a primed file, each user session imports it on startup." No Workbench-specific code path needed in the cache service.
- JSON shape — the export format is the same shape stored in `IStorageService` today. Documented schema, versioned via `RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION`. A Workbench-primed file and an e2e-primed file are interchangeable.

**Out of scope here (Workbench design work, when the team picks it up):**
- Multi-user policy: who can read the shared cache, how stale-cache invalidation is communicated across user sessions, whether per-user caches layer on top of the server cache.
- Where the server cache file lives, who writes it, how often it refreshes.
- Permissions / access-control on the cache file in shared environments.
- Whether the import path should ever merge a server cache with an existing user cache (today's "don't clobber" rule means whoever populates the storage key first wins; that may need to be revisited for Workbench).

**Why this matters for the present design:** the export side is intentionally a first-class CLI flag rather than a private hack (no SQLite scraping, no test-only API). When Workbench picks this up, there's no rework — they invoke the same flag, consume the same JSON, set the same env var. The base experiment for e2e is also the foundation for the multi-user case.

## Open questions

1. **Exact file list for `INTERPRETER_MANIFEST_HASH`.** Probably `.devcontainer/Dockerfile` + Python/R install scripts + any version-pinning files referenced from them. Settle during plan-writing.
2. **Where the CLI flag wires into Positron's argv parsing**, and the cleanest mechanism to signal "do the work then exit" from a workbench contribution. May piggyback on existing one-shot CLI patterns (e.g. `--list-extensions`). Settle during plan-writing.
3. **Where the prime script lives** — `test/e2e/scripts/` vs `build/scripts/` vs a new location. Probably `test/e2e/scripts/` since it depends on the e2e launcher's binary-resolution logic.
4. **Whether to auto-detect the seed file in the launch fixture** (so tests transparently benefit) **or require explicit opt-in** (so a missing seed is loud, not silent). Auto-detect with a `--no-cache-seed` opt-out feels right for most cases; confirm during plan-writing.

## Success criteria

- A `test-pull-request` run against a stable container completes faster than baseline by the wall-clock equivalent of skipping `Discovering` across all shards.
- No new flakes attributable to cache seeding over the rollout period.
- Cache hit rate on the inline `actions/cache` step exceeds 90% across PR runs over a 2-week window.
- Local developer running `npx playwright test ...` on a primed machine sees the same wall-clock improvement as CI.
