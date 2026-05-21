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
│ Component 1: Production (split across layers)               │
│  1a (common):           importCacheState(payload)           │
│  1b (common):           exportCacheState() -> payload       │
│  1c (electron-sandbox): bootstrap contribution reads env+fs,│
│                         calls importCacheState              │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ in-process API (exportCacheState)
                              │
┌─────────────────────────────────────────────────────────────┐
│ Component 2: CLI export flag (shared primitive)             │
│ --export-discovery-cache=PATH: boot, wait Complete, dump,   │
│ ILifecycleService.quit()                                    │
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

Three additions, split across layers to respect VS Code's `common`/`node`/`electron-*` boundaries:

- **1a (common):** `importCacheState(json: string)` method on `IRuntimeDiscoveryCache` — accepts a pre-read JSON payload and stores it via `IStorageService`. No env, no fs.
- **1b (common):** `exportCacheState()` method on `IRuntimeDiscoveryCache` — returns the in-memory cache as a JSON-serializable payload.
- **1c (electron-sandbox):** Seed bootstrapping contribution that reads the env var and seed file, then calls `importCacheState()`. Lives outside `common/` because env-var and filesystem access aren't legal there.

### 1a. Import API (common)

Add a method to the `IRuntimeDiscoveryCache` interface in `runtimeDiscoveryCacheService.ts`:

```ts
/**
 * Replace the cache state with the payload, if and only if the storage row
 * is currently empty. Used to seed the cache from an external source
 * (e.g. a test prime file, a Workbench-managed server cache).
 *
 * Returns true if the import happened, false if skipped (existing cache wins).
 */
importCacheState(payload: IDiscoveryCachePayload): boolean;
```

Implementation in `runtimeDiscoveryCache.ts` (common):

```ts
importCacheState(payload: IDiscoveryCachePayload): boolean {
    if (this._storageService.get(RUNTIME_DISCOVERY_CACHE_STORAGE_KEY, StorageScope.APPLICATION)) {
        // Don't clobber an existing cache — local dev with real Positron state should win.
        return false;
    }
    // Schema-version check: payload from an older/newer schema is ignored.
    if (payload.schemaVersion !== RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION) {
        this._logService.warn(`[discoveryCache] seed schema mismatch (got v${payload.schemaVersion}, expected v${RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION}); skipping import`);
        return false;
    }
    this._storageService.store(
        RUNTIME_DISCOVERY_CACHE_STORAGE_KEY,
        JSON.stringify(payload),
        StorageScope.APPLICATION,
        StorageTarget.MACHINE,
    );
    this._logService.info(`[discoveryCache] imported cache state with ${payload.buckets.length} buckets`);
    return true;
}
```

**Why a service method, not env-var-and-fs in the constructor:**
- `process.env` doesn't exist in browser contexts. VS Code's layering rules forbid `process` references in `common/`. The original spec read `process.env` in `common/`, which would fail at the eslint layer check (and at runtime in web Positron).
- `fs` is Node-only; the cache service already routes file I/O through the injected `IFileService` to stay layer-clean. Reading the seed file in `common/` would break the same boundary.
- Splitting the API surface (in-memory state mutation in common, env+fs reads in a non-common contribution) keeps each layer doing what it's allowed to do.
- `importCacheState` is symmetric with `exportCacheState`. Vitest can test the import path with a JSON payload constructed in-test, no fs or process needed.

### 1b. Export API (common)

Add a symmetric method:

```ts
/**
 * Return the current cache state as a JSON-serializable payload.
 * The shape matches what is persisted to IStorageService and what
 * importCacheState() accepts, so export -> import round-trips cleanly.
 */
exportCacheState(): IDiscoveryCachePayload;
```

The implementation reads the current in-memory cache state and returns it. `JSON.stringify(exportCacheState())` produces the exact string that the storage row already holds. This is the in-process API that Component 2 (CLI flag), Workbench tooling, and diagnostics all build on.

**Type location for `IDiscoveryCachePayload`:** export the existing internal `IPersistedCache` shape under the public name `IDiscoveryCachePayload` from `runtimeDiscoveryCacheService.ts`. The interface already captures the persisted shape; renaming-on-export gives external callers (Workbench, tooling) a stable public type name without duplicating the definition. Include `schemaVersion: number` as a top-level field on the payload so import-side validation has something to check (today, the schema version is implicit in the storage key — making it explicit in the payload lets imports be validated before storage is touched).

### 1c. Seed bootstrapping (electron-sandbox)

A new workbench contribution registered in `src/vs/workbench/services/runtimeStartup/electron-sandbox/runtimeDiscoveryCacheBootstrap.ts`. Pseudocode:

```ts
class RuntimeDiscoveryCacheBootstrap implements IWorkbenchContribution {
    constructor(
        @IRuntimeDiscoveryCache cache: IRuntimeDiscoveryCache,
        @INativeEnvironmentService env: INativeEnvironmentService,
        @IFileService fileService: IFileService,
        @ILogService logService: ILogService,
    ) {
        this.maybeSeed(cache, env, fileService, logService);
    }

    private async maybeSeed(...) {
        const seedPath = env.runtimeDiscoveryCacheSeedPath; // surfaced via INativeEnvironmentService
        if (!seedPath) { return; }

        let raw: string;
        try {
            const content = await fileService.readFile(URI.file(seedPath));
            raw = content.value.toString();
        } catch (e) {
            logService.warn(`[discoveryCache] seed file unreadable at ${seedPath}: ${e}`);
            return;
        }

        let payload: IDiscoveryCachePayload;
        try {
            payload = JSON.parse(raw);
        } catch (e) {
            logService.warn(`[discoveryCache] seed file malformed: ${e}`);
            return;
        }

        cache.importCacheState(payload);
    }
}
```

**Wiring the env var to `INativeEnvironmentService`:** `EnvironmentMainService` (electron-main) reads `process.env.POSITRON_RUNTIME_DISCOVERY_CACHE_SEED` during startup and surfaces it as a typed property `runtimeDiscoveryCacheSeedPath: string | undefined` on `INativeEnvironmentService`. This is the canonical pattern in VS Code for env vars that need to reach the renderer (env vars are unavailable in `common/` and the workbench renderer reads them via this service). The exact field name and electron-main wiring is finalized during plan-writing.

**Registration:** registered in the workbench contribution registry at `LifecyclePhase.Restored` (or earlier — whatever fires before the cache service is first consulted by other startup services). Order matters: the bootstrap must complete its `importCacheState` call before any service reads the cache key.

**Production safety:** in production builds, the env var is harmless if set (the cache service validates the payload's schema version and JSON shape, and refuses to clobber an existing cache row). See the Security row in [Risks](#risks) for the full discussion.

## Component 2: CLI export flag

**New flag:** `positron --export-discovery-cache=PATH`

**Behavior:**
1. Parse the flag during CLI argument processing; the value (a path) is surfaced on `INativeEnvironmentService` (same pattern as 1c).
2. App boots normally — full workbench, runtime services, the lot. The export needs discovery to have actually run, which only happens with the workbench fully up. (This is unlike `--list-extensions`, which short-circuits before the workbench boots — that mechanism is **not** applicable here.)
3. A new electron-sandbox workbench contribution observes `IRuntimeStartupService` for the startup phase to reach `Complete`.
4. On `Complete`, the contribution resolves `IRuntimeDiscoveryCache`, calls `exportCacheState()`, writes `JSON.stringify(result)` to the path via `IFileService`, and then calls `ILifecycleService.quit()` to shut the app down cleanly.
5. The contribution also installs a watchdog timer (default 5 minutes — configurable via the same CLI flag's optional second argument or a fixed constant). If `Complete` is not reached in time, log to stderr and call `ILifecycleService.quit()` with a non-zero exit hint so the process surfaces an error to the calling script.
6. On write failure, same handling — log and quit non-zero.

**Why a CLI flag, not a command palette command:**
- Scriptable from any shell — no Electron API knowledge required.
- Works headlessly — the prime script and Workbench tooling both want to invoke this without UI interaction.
- Symmetric with the existing pattern of CLI flags for diagnostic / one-shot operations.
- Language-agnostic — Workbench's eventual integration likely runs from a shell script, not from a VS Code extension.

**Implementation location:**
- Flag declaration: wherever Positron CLI args are parsed (alongside other Positron-specific CLI flags). Settled during plan-writing.
- Behavior contribution: `src/vs/workbench/services/runtimeStartup/electron-sandbox/runtimeDiscoveryCacheExport.ts`, registered at a phase that runs after the workbench is up. Sibling to the bootstrap contribution from 1c.

**Why `ILifecycleService.quit()` and not a CLI short-circuit:** `--list-extensions` and similar flags work by short-circuiting before the workbench boots — that mechanism is **inapplicable here** because the export depends on runtime startup completing, which requires the full workbench to be running. The right exit primitive is `ILifecycleService.quit()` (or `ILifecycleMainService.quit()` if the contribution needs to live in electron-main), which performs a graceful shutdown that flushes pending IStorageService writes and respects shutdown listeners. Resolved.

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
2. `actions/cache@v5` with that key and `path: ${{ runner.temp }}/positron-e2e-cache/`. On hit, the seed file is restored. On miss, the action records the key for save-on-success. `runner.temp` is a GitHub-provided variable that resolves to an OS-appropriate temp directory on Linux, macOS, and Windows.
3. If the seed file is missing after the cache step: run `npm run prime-discovery-cache -- --out "${{ runner.temp }}/positron-e2e-cache/discovery-cache.json"`.
4. Set `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED=${{ runner.temp }}/positron-e2e-cache/discovery-cache.json` on the test command's environment.

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
  │      ├─ HIT: seed file appears at ${runner.temp}/positron-e2e-cache/discovery-cache.json
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
| Env var unset | Bootstrap contribution checks the seed-path property on `INativeEnvironmentService`; if undefined, returns immediately. No file I/O attempted. | Unit (vitest) — bootstrap contribution test |
| Seed file missing | `IFileService.readFile` throws; bootstrap catches, logs warning, returns. `importCacheState` is never called. | Unit (vitest) — bootstrap contribution test |
| Seed file malformed JSON | `JSON.parse` throws; bootstrap catches, logs warning, returns. | Unit (vitest) — bootstrap contribution test |
| Storage key already populated | `importCacheState` checks the storage key and returns `false`; no log, no clobber. | Unit (vitest) — cache service test |
| Per-entry fingerprint stale | Existing fingerprint check evicts entry | Already tested in `runtimeDiscoveryCache.vitest.ts` |
| Discovery root signature stale | Existing root-signature check triggers full discovery for that bucket | Already tested |
| Schema version mismatch | `importCacheState` checks `payload.schemaVersion` against `RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION` and refuses to import; existing cache (if any) is untouched. If the schema version bump *also* invalidates the persisted storage row (per `_reloadFromStorage()`'s wipe-and-rediscover path), the cache is wiped and a full discovery pass runs. Net: stale seeds never poison a newer schema. | Unit (vitest) |
| Prime step fails in one shard | That shard runs without a seed (status-quo behavior). The prime step uses `continue-on-error: true` so a script bug doesn't fail the test job. | Workflow-level |
| Prime step / CLI flag hangs | CLI flag has a built-in 5-minute watchdog (configurable constant in source) — if startup phase doesn't reach `Complete` in time, it logs to stderr and quits non-zero. Workflow step also sets `timeout-minutes: 10` as belt-and-suspenders. Either trigger surfaces a clear error to the calling script. | Workflow-level + CLI test |
| Parallel shards saving the same cache key | `actions/cache@v5` is idempotent on save: first save wins, subsequent saves with same key are no-ops. No special handling needed. | n/a |

## Testing strategy

**Cache service — import API (vitest):** Extend `src/vs/workbench/services/runtimeStartup/test/common/runtimeDiscoveryCache.vitest.ts` with cases for `importCacheState(payload)`:
- Empty storage + valid payload → storage row populated, returns `true`.
- Storage row already populated → returns `false`, existing row untouched.
- Payload `schemaVersion` differs from current → returns `false`, warning logged, no write.
- Empty `buckets` array → valid, storage row populated with the empty payload shape.

These tests construct payloads directly in-test; no env, no fs, no `process` reference. The common-layer service stays layer-clean.

**Cache service — export API (vitest):** Cases for:
- Empty cache → `exportCacheState()` returns the empty payload shape with current schema version.
- Populated cache → `exportCacheState()` returns a payload that round-trips through `importCacheState` and produces an identical storage row.
- `schemaVersion` field equals `RUNTIME_DISCOVERY_CACHE_SCHEMA_VERSION`.

**Bootstrap contribution (vitest, electron-sandbox layer):** new file alongside the contribution. Cases:
- Seed-path property undefined → contribution returns without calling `cache.importCacheState`.
- Seed-path set, file readable, valid JSON → `cache.importCacheState` called with parsed payload.
- Seed-path set, file unreadable → warning logged, `cache.importCacheState` not called.
- Seed-path set, file malformed JSON → warning logged, `cache.importCacheState` not called.

Use stub `IFileService` and stub `INativeEnvironmentService` per the standard builder pattern.

**CLI export flag (E2E Playwright):** A new e2e test at `test/e2e/tests/runtime-cache/export-cli.test.ts` (or similar), `--project e2e-electron`, that:
1. Spawns the Positron binary with `--export-discovery-cache=<tmp>` and a throwaway user-data-dir.
2. Waits for the process to exit (expects exit code 0 within the 5-minute internal timeout).
3. Reads the output file, parses as JSON, asserts the shape matches `IDiscoveryCachePayload` (presence of `schemaVersion`, `buckets`).

Runs in the same e2e matrix as other tests. Lives in `test/e2e/tests/` so it benefits from existing launch infra without duplicating it.

**End-to-end smoke test:** One existing e2e test runs both with and without the seed env var; both should pass, the seeded one should show a log line confirming the seed was loaded. Manual verification during initial rollout, not a permanent test.

## Rollout

**Step 0 — Resolve gating open questions.** Lock down before any implementation begins:
- Q1 (file list for `INTERPRETER_MANIFEST_HASH`) gates Step 4.
- Q2 (CLI argv wiring + exit mechanism) gates Step 2. Already partially resolved in Component 2: `ILifecycleService.quit()` is the exit primitive; the remaining sub-question is the precise location where the new arg is added to `ParsedArgs`/`INativeEnvironmentService`. Confirm before coding Step 2.
- Q4 (auto-detect vs explicit opt-in for the seed env var in the launch fixture) gates Step 3.

Q3 (script location) is non-gating — defaults to `test/e2e/scripts/`.

**Step 1 — Cache service: `importCacheState` + `exportCacheState` (common).** Both methods land with vitest coverage. Manual verification before merge: build Positron locally, populate the cache through a normal startup, open a debug console (or add a temporary log line), call `cache.exportCacheState()`, confirm the returned payload shape and contents are sensible. Remove any temporary logging before merge. This guards against shape bugs that vitest round-trips don't catch (e.g. `exportCacheState` being called before the in-memory cache is fully populated).

**Step 2 — CLI export flag + bootstrap contribution (electron-sandbox).** Both pieces land together since they share the `INativeEnvironmentService` wiring. End-to-end testable locally: `positron --export-discovery-cache=/tmp/cache.json` should exit 0 with a valid JSON file; subsequent launches with `POSITRON_RUNTIME_DISCOVERY_CACHE_SEED=/tmp/cache.json` should log the import.

**Step 3 — Prime script + local workflow.** Developers can opt in manually; not yet wired into CI.

**Step 4 — CI wiring (one workflow).** Against `test-pull-request.yml` only. Verify wall-clock improvement and zero new flakes over ~1 week.

**Step 5 — Expand to remaining workflows.** `test-merge.yml`, then `positron-builds` test-release matrix.

Each step is independently revertable. If a regression appears in step 4 or 5, removing the env var from one workflow restores today's behavior with zero code change.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Bug in new seed-import code | Low | Env var-gated; bootstrap returns early when unset. Vitest covers all branches of the bootstrap contribution + cache service. |
| Env var accessible in production builds (set by user or malicious injection) | Low | The env var is **intentionally enabled in production builds** — it's the same mechanism Posit Workbench will use to seed a server-wide cache, so gating it behind a `POSITRON_TEST_` prefix or `--enable-proposed-api` would block that use case. Risk surface is bounded by: (a) `importCacheState` only runs when the storage row is empty (no clobber); (b) payload is validated against `IDiscoveryCachePayload` shape + `schemaVersion` before any write; (c) the payload contains interpreter binary paths and version metadata — same content already in users' production caches — no credentials, no project data; (d) `IFileService` honors the existing fs permissions, so an attacker can't escalate by pointing the env var at a privileged file. If a future need for production gating emerges, adding a guard is a small follow-up. |
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

Gating questions (must resolve before the listed rollout step):

1. **(Gates Step 4) Exact file list for `INTERPRETER_MANIFEST_HASH`.** Probably `.devcontainer/Dockerfile` + Python/R install scripts + any version-pinning files referenced from them. Settle during plan-writing.
2. **(Gates Step 2) Precise wiring of the new CLI arg into `ParsedArgs` and `INativeEnvironmentService`.** The exit mechanism is settled (`ILifecycleService.quit()` — see Component 2). The remaining sub-question is which existing argv parsing site to extend and the property name on `INativeEnvironmentService` (e.g. `runtimeDiscoveryCacheExportPath`).
3. **(Gates Step 3) Whether to auto-detect the seed file in the launch fixture** (so tests transparently benefit) **or require explicit opt-in** (so a missing seed is loud, not silent). Auto-detect with a `--no-cache-seed` opt-out feels right for most cases; confirm during plan-writing.

Non-gating:

4. **Where the prime script lives** — `test/e2e/scripts/` vs `build/scripts/` vs a new location. Defaulting to `test/e2e/scripts/` since it depends on the e2e launcher's binary-resolution logic.

## Success criteria

- A `test-pull-request` run against a stable container completes faster than baseline by the wall-clock equivalent of skipping `Discovering` across all shards.
- No new flakes attributable to cache seeding over the rollout period.
- Cache hit rate on the inline `actions/cache` step exceeds 90% across PR runs over a 2-week window.
- Local developer running `npx playwright test ...` on a primed machine sees the same wall-clock improvement as CI.
