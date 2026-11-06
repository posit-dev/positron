# Positron API smoke spike

A minimal, self-contained prototype for step 5 of
[posit-dev/positron#14530](https://github.com/posit-dev/positron/issues/14530):
a trivial extension whose single Mocha extension-host test downloads a real
Positron daily and confirms it can acquire a **live `positron.*` API** via
`tryAcquirePositronApi()` (open-question **E**).

This is a research prototype, not CI infrastructure. macOS / arm64 only.

## What it does

1. `runTests.ts` (plain Node tooling) downloads the current Positron daily from
   `cdn.posit.co` and caches it under `.vscode-test/positron-darwin/`. The
   download logic is a darwin-only copy of positron-python's
   `downloadAndUnzipPositron()`
   (`extensions/positron-python/src/test/positron/testElectron.ts`) - copied,
   not imported, because an external extension author cannot reach into
   positron-python internals.
2. It launches that downloaded Positron via `@vscode/test-electron`, loading this
   trivial extension and running the Mocha suite in the extension host.
3. `src/test/suite/api.test.ts` calls `tryAcquirePositronApi()` from
   `@posit-dev/positron` and asserts the returned object is a live API handle.

## Run it

```sh
cd test/positron-api-smoke
npm install
npm test
```

`npm test` compiles `src/` to `out/` and runs `node ./out/runTests.js`. The first
run downloads the daily (hundreds of MB); later runs reuse the cache when the
daily version is unchanged.

No GitHub PAT is required - the daily `releases.json` and zip on `cdn.posit.co`
are public. (positron-python resolves a PAT only to rate-limit a GitHub API call;
this spike keeps that as best-effort and never fails on a missing PAT.)

## Findings

### The Positron API is live in a downloaded build

Confirmed. Running against daily `2026.08.0` (build 23), inside the downloaded
extension host:

- `inPositron()` returns `true`.
- `tryAcquirePositronApi()` returns a live object (not `undefined`, which is what
  it returns under plain VS Code).
- `positron.version` is a non-empty string (`"2026.08.0"`).

This is the whole point of the spike: an extension that depends only on
`@posit-dev/positron` and targets a downloaded Positron gets the real API in its
test host, with no clone/build of the fork.

**Why it works:** `src/bootstrap-esm.ts` defines
`globalThis.acquirePositronApi = () => require('positron')`. That bootstrap is
shared by the extension host process, so the global is present for any loaded
extension in a real (and therefore downloaded) build.
`@posit-dev/positron`'s `tryAcquirePositronApi()` just calls that global.

### Gotchas

- **Gatekeeper: not an issue with a programmatic download.** The cached
  `Positron.app` carries only `com.apple.provenance`, never
  `com.apple.quarantine`. macOS applies quarantine to browser/LaunchServices
  downloads, not to an archive fetched with `https.get` and extracted with CLI
  `unzip`. So Gatekeeper does not block the headless launch. `runTests.ts` still
  runs `xattr -dr com.apple.quarantine` defensively; it is a no-op in the common
  case (and would matter only if a build were obtained via a browser).
- **`--user-data-dir` is mandatory.** The runner launches with a fresh temp
  `--user-data-dir`. It isolates state across runs and, combined with the flags
  below, keeps first-run prompts out of the way. positron-python's harness also
  needs it to dodge a path-length issue on CI.
- **First-run dialogs are suppressed** by the clean user-data-dir plus
  `--skip-welcome` and `--skip-release-notes`. No welcome, release-notes, or
  workspace-trust prompt appeared; the run is fully headless.
- **`--disable-extensions` does not disable Positron's built-in extensions.**
  It disables third-party/user extensions, but built-ins still load: on the first
  run `posit.assistant` auto-updated and `positron.positron-assistant` logged a
  benign `authentication id 'posit-ai' has already been registered` warning (and
  some `GitHubLoginFailed` rejections, expected with no credentials in a headless
  host). The extension under test (`extensionDevelopmentPath`) always loads
  regardless. None of this affected the API acquisition.
- **Built-in runtime providers register runtimes under `--disable-extensions`.**
  Verified by `runtime.test.ts`: with the flag on, `positron-python` and
  `positron-r` both activate (positron-python via its `onStartupFinished`
  activation event) and register runtimes -- 26 total (`Python`, `R`) on this dev
  machine. So a third-party author can keep `--disable-extensions` for a clean,
  deterministic host and still exercise runtime-dependent `positron.*` APIs
  (`getRegisteredRuntimes`, `executeCode`, sessions). Note discovery is async and
  providers register at different speeds -- R is near-instant, Python interpreter
  discovery takes longer -- so a runtime test must poll/wait for the set to settle
  rather than reading it once. Keep the flag on by default; only drop it (and
  install the specific dependency via `resolveCliArgsFromVSCodeExecutablePath` +
  `--install-extension`) when the extension depends on a *marketplace* extension.

### Bonus finding: `buildNumber` typings/runtime mismatch

`src/positron-dts/positron.d.ts` declares `export const buildNumber: number`, but
at runtime `positron.buildNumber` is a **string** (`"23"`). The test asserts only
that it is defined and logs its actual `typeof`. Worth a follow-up fix to the
typings (or the runtime value) so they agree.

## Files

| File | Role |
|---|---|
| `src/runTests.ts` | Node tooling: download daily + launch ext-host test |
| `src/extension.ts` | Trivial no-op extension (just needs to load) |
| `src/test/index.ts` | Mocha bootstrapper run inside the ext host |
| `src/test/suite/api.test.ts` | Acquire + assert the live API |
| `src/test/suite/runtime.test.ts` | Confirm built-in runtime providers register under `--disable-extensions` |

## Notes for a real author

An extension shipping this for real would keep the same shape but:

- Not vendor `downloadAndUnzipPositron()` by hand - that logic is the client
  piece open-question **B** proposes packaging (e.g.
  `@posit-dev/positron-test-electron`). This spike copies it precisely to show
  what that package would encapsulate.
- Likely target multiple platforms and pin/enumerate versions (open-questions
  A/C), rather than always taking the latest darwin/arm64 daily.
