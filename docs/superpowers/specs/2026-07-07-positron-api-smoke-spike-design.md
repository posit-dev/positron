# Downloadable-Positron API smoke spike

Design doc for a prototype that closes out step 5 of
[#14530](https://github.com/posit-dev/positron/issues/14530): run a trivial
extension's Mocha extension-host test against a *downloaded* Positron daily and
confirm the extension can acquire a live `positron.*` API via
`tryAcquirePositronApi()`.

## Goal

The RFC's end-state UX is that a Positron-targeting extension (Quarto, Shiny,
Assistant, ...) can write extension integration tests -- structured like the
tests you'd write for a VS-Code-only extension -- that exercise the **Positron
API** against a downloaded Positron extension host, without building Positron
from source.

This spike proves the last unknown in that chain (open-question **E**): that a
downloaded Positron desktop build actually injects the API accessor into the
extension host, so `tryAcquirePositronApi()` returns a live object there rather
than `undefined` (as it does under plain VS Code).

The deliverable is two things:

1. A **runnable prototype** committed under `test/positron-api-smoke/`.
2. A **findings writeup** (in that dir's `README.md`): did the API come back
   live, its `version`/`buildNumber`, and the three macOS gotchas -- Gatekeeper,
   `--user-data-dir`, first-run dialogs.

This is a research prototype, not production infrastructure. It is intentionally
self-contained and does not wire into CI.

## Background: how the pieces already fit

- **Download logic already exists.** positron-python's
  `extensions/positron-python/src/test/positron/testElectron.ts` exports
  `downloadAndUnzipPositron()`. It reads the latest daily from
  `https://cdn.posit.co/positron/dailies/mac/arm64/releases.json`, downloads the
  `Positron-darwin-<version>-arm64.zip`, unzips to
  `.vscode-test/positron-darwin/Positron.app`, caches by version (an
  `is-complete` marker file), and returns `{ version, executablePath }`. A build
  is already cached locally: `2026.06.0-18`.
- **The API accessor.** `@posit-dev/positron` (npm, `0.2.4`) exports
  `tryAcquirePositronApi()` and `inPositron()`. `tryAcquirePositronApi()` calls a
  global `acquirePositronApi()`; if the global is absent (plain VS Code) it
  returns `undefined`.
- **Where the global comes from.** `src/bootstrap-esm.ts:49` defines
  `globalThis.acquirePositronApi = () => require('positron')`. This is the shared
  ESM bootstrap the extension host loads, so the global is present for any loaded
  extension in a real (and therefore downloaded) Positron build. This is the
  mechanism the spike verifies end to end.
- **The runner pattern.** positron-python's `testElectron.ts` also wraps
  `@vscode/test-electron`'s `runTests(...)`, passing `vscodeExecutablePath` (the
  downloaded Positron) and appending `--user-data-dir <tmp>`.

## Scope

In scope:

- A trivial extension (no real functionality) that just needs to load.
- Exactly one Mocha test that acquires the Positron API and asserts on a trivial,
  synchronous `positron.*` member.
- A runner that downloads/reuses the daily and launches the ext-host test.
- macOS / arm64 only (matches the existing download logic and the task).
- Written findings.

Out of scope (explicitly, per YAGNI):

- CI wiring.
- Cross-platform support (win32/linux).
- Publishing a reusable `@posit-dev/positron-test-electron` package (that is
  open-question B, a separate future step).
- Any change to the download server contract (open-questions A/C).

## Layout

Committed, self-contained, TypeScript:

```
test/positron-api-smoke/
  package.json          # deps + compile/test scripts
  tsconfig.json         # out -> out/, module commonjs, strict
  .gitignore            # out/, node_modules/, .vscode-test/
  src/
    extension.ts        # trivial activate() no-op
    runTests.ts         # copied downloadAndUnzipPositron() logic + @vscode/test-electron runTests
    test/
      index.ts          # Mocha bootstrapper (globs suite/*.test.js)
      suite/
        api.test.ts     # THE test
  out/                  # compiled output (gitignored)
  README.md             # run instructions + findings
```

Two execution contexts share one tsconfig:

- `runTests.ts` is **tooling** -- runs under plain Node, downloads the build,
  calls `@vscode/test-electron`.
- `extension.ts` + `test/**` run **inside the downloaded Positron extension
  host**.

## Components

### `package.json`

- `main`: `./out/extension.js`
- `engines.vscode`: a version the daily satisfies (e.g. `^1.100.0`; confirm
  against the daily's `product.json` during implementation).
- `activationEvents`: `["*"]` so the extension is active when the test host
  starts.
- `dependencies`: `@posit-dev/positron`, `@vscode/test-electron`, `mocha`, `glob`.
- `devDependencies`: `typescript`, `@types/node`, `@types/mocha`,
  `@types/vscode`.
- `scripts`: `"compile": "tsc -p ./"`,
  `"test": "npm run compile && node ./out/runTests.js"`.

### `src/extension.ts`

```ts
import * as vscode from 'vscode';
export function activate(_context: vscode.ExtensionContext) { /* no-op */ }
export function deactivate() { /* no-op */ }
```

### `src/runTests.ts`

Copies (not imports) a darwin-only trim of `downloadAndUnzipPositron()` from
positron-python, then:

```ts
const { version, executablePath } = await downloadAndUnzipPositron();
await runTests({
  version,
  vscodeExecutablePath: executablePath,
  extensionDevelopmentPath: <this dir>,
  extensionTestsPath: <out/test/index.js>,
  launchArgs: ['--user-data-dir', <tmp>, '--disable-extensions'],
});
```

Copying rather than importing is the faithful RFC interpretation: an *external*
author cannot import positron-python internals, so the spike demonstrates exactly
what they would vendor/reimplement. It also keeps the spike self-contained and
reuses the already-cached build.

The GitHub-PAT branch of the original function is only used for GitHub API rate
limiting; the actual bytes come from the public CDN. The trim keeps the PAT
lookup (so behavior matches positron-python) but the CDN download is what
matters.

### `src/test/index.ts`

Standard Mocha bootstrapper: construct `new Mocha({ ui: 'tdd', color: true })`,
glob `suite/**/*.test.js` under `__dirname`, add files, `mocha.run(...)`,
resolve/reject on failure count.

### `src/test/suite/api.test.ts`

```ts
import * as assert from 'assert';
import { tryAcquirePositronApi, inPositron } from '@posit-dev/positron';

suite('Positron API smoke', () => {
  test('acquires a live Positron API in the downloaded ext host', () => {
    assert.strictEqual(inPositron(), true);        // global was injected
    const positron = tryAcquirePositronApi();
    assert.ok(positron, 'tryAcquirePositronApi() returned undefined');
    assert.strictEqual(typeof positron.version, 'string');
    assert.ok(positron.version.length > 0);
    assert.strictEqual(typeof positron.buildNumber, 'number');
  });
});
```

`positron.version` (string) and `positron.buildNumber` (number) are trivial,
synchronous top-level members (`src/positron-dts/positron.d.ts:18,24`). No
runtime start, no side effects -- the minimum that proves the object is live.

## Data flow

1. `npm test` -> `tsc` compiles `src/**` to `out/**`.
2. `node out/runTests.js` (plain Node): `downloadAndUnzipPositron()` returns the
   cached/downloaded daily's executable path + version.
3. `@vscode/test-electron` launches that Positron with
   `--extensionDevelopmentPath` (our extension) and `--extensionTestsPath`
   (`out/test/index.js`), plus `--user-data-dir <tmp> --disable-extensions`.
4. Positron boots; `bootstrap-esm.ts` defines `globalThis.acquirePositronApi`.
5. Our extension activates; Mocha runs `api.test.js` in the ext host.
6. `tryAcquirePositronApi()` -> global -> `require('positron')` -> live API.
7. Assertions pass; process exit code propagates to `runTests.ts` -> `npm test`.

## Error handling

- Download failure (no PAT / network / CDN non-200): surfaced by the copied
  logic's existing throws; the runner lets them propagate and exits non-zero.
- API `undefined`: the test fails with a clear assert message -- this is the
  negative signal the spike is designed to catch.
- Gatekeeper quarantine blocking launch: documented remedy
  `xattr -dr com.apple.quarantine <Positron.app>`; the README notes it and the
  runner may pre-strip it if launch fails (decided during implementation).

## Testing / verification

This *is* a test harness, so "verification" means running it and observing:

- Exit code 0 and Mocha reporting `1 passing`.
- Console shows the acquired `version` matches the downloaded daily's version and
  a numeric `buildNumber`.

Manual run only (`npm test` in the spike dir). Per project guidance, we do not
attempt to launch via the full Positron dev build or devcontainer; the spike
launches the *downloaded* app directly, which is the whole point.

## Findings to capture in README (post-run)

- Confirmation that `tryAcquirePositronApi()` returns a live object in a
  downloaded build, with the observed `version` / `buildNumber`.
- **Gatekeeper**: whether the downloaded `.app` is quarantined and needs
  `xattr -dr com.apple.quarantine`, and whether `@vscode/test-electron`'s launch
  path trips it.
- **`--user-data-dir`**: why a temp dir is mandatory (clean state; also avoids a
  path-length issue noted in positron-python's harness).
- **First-run dialogs**: whether release-notes / workspace-trust / telemetry
  prompts appear and how a clean user-data-dir + `--disable-extensions`
  suppresses them.

## Open decisions deferred to implementation

- Exact `engines.vscode` value the daily accepts.
- Whether `runTests.ts` pre-strips the quarantine xattr or just documents it.
- Whether `--skip-welcome` / `--skip-release-notes` launch args are needed on top
  of the clean user-data-dir.
