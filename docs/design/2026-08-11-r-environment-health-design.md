# R environment health check

Design for [#15064](https://github.com/posit-dev/positron/issues/15064). Mirrors the Python
environment health check shipped in [#14890](https://github.com/posit-dev/positron/pull/14890).

## Goal

A command that reports, as JSON, whether the current R setup is ready to start a session in line
with Positron's recommendations. Each reported item carries an optional fix a frontend can invoke.

This is backend groundwork. There is no UI in this change: the report is reachable from the Command
Palette and logged to the R output channel. The `fix` objects are data in the report, not rendered
buttons. A frontend comes later.

## What the Python check is, and is not

Issue [#14694](https://github.com/posit-dev/positron/issues/14694) framed the Python check as
"everything's in order to start a new Python session aligned with our recommendations" -- a guided
setup nudge with fix buttons, not a post-mortem for a session that failed to start. Three of its
four items fire on setups that work fine; a global Python with no venv starts a session, and
`dedicatedEnvironment` fails it anyway to steer the user toward isolation.

The R check has the same purpose.

## Architecture

One new module, `extensions/positron-r/src/environmentHealth.ts`, following the Python module's
shape: exported pure `probe*` functions that take plain dependency objects, plus an `assembleItems`
orchestrator that runs them in dependency order and short-circuits later items to `skipped`.

The JSON types (`HealthItemStatus`, `HealthItemFix`, `HealthItem`) are structurally identical to
Python's so a future frontend can render both reports through one component.

Two deviations from the Python module, both forced by how positron-r works:

**No discovery cache to read.** Python reads `IInterpreterService.getInterpreters()`. positron-r has
no cached install list and no `lastDiscoveryError` signal. Discovery is cheap and is already re-run
on demand before the interpreter quick pick (`runtime-quickpick.ts:45-48`), so the command runs
`getBinaries()` once and memoizes the resulting `RInstallation[]`. This is the same memoized-snapshot
pattern as `resolveSnapshot()` in the Python module, for the same reason: later items must read the
post-discovery list, not a pre-discovery one.

**The would-be R comes from core**, via `positron.runtime.getPreferredRuntime('r')`, which returns
`LanguageRuntimeMetadata | undefined`. The join key back to the discovered `RInstallation[]` is
`metadata.runtimePath`, which `makeMetadata` sets directly from `rInst.binpath`
(`provider.ts:687`), so the match is exact rather than heuristic. This is the real answer to "what
would start", and it already accounts for the `positron.r.interpreters.default` setting.

## Probe depth: static only

Every check reads files on disk. Nothing spawns a subprocess and nothing needs a live R session.

This is a deliberate narrowing relative to Python, whose `environmentReady` really does spawn the
interpreter (`pythonEnvironment.ts:98-101`, via `environmentHealth.ts:645`). Python gets high
coverage from that almost for free because its kernel *is* the interpreter -- ipykernel is a library
imported into the same process, so "the interpreter runs" plus "ipykernel imports" covers nearly the
whole startup path.

R has no cheap equivalent. Ark is a separate compiled binary that dlopens `libR`
(`crates/harp/src/sys/{unix,windows}/library.rs`). Spawning `R --version` would prove the R shell
wrapper works and prove nothing about whether ark can load that R's shared library. It costs a
subprocess and buys much less than the Python probe it superficially resembles.

### Deferred: an ark load probe

The one failure class static checks miss is bad dynamic linkage -- `libR` present but its own
dependencies (libRlapack, libgfortran, ICU) unresolvable. The check reports green and the session
still fails to start.

Catching that needs ark to load the library and report back. Ark has no such subcommand today
(`--version` prints a string and returns, `crates/ark/src/main.rs:151-154`). Adding one is small in
Rust -- ark already has `harp::open_r_shared_library` -- but it lands in a different repo, so it
means an ark PR, a merge, and a submodule bump before this work could ship.

Deferred as a follow-up, not a blocker. It is outside what this issue asks for, and it slots into
`environmentReady` as one more gate before the arch warn, so adding it later is not rework.

## The four checks

Run in dependency order. A `fail` short-circuits every later item to `skipped`.

### 1. `discovery`

Passes when `getBinaries()` returned at least one R binary.

Fails when it returned none or threw. Fix: Show Runtime Startup Diagnostics
(`positron.startupDiagnostics.show`).

### 2. `rInstalled`

Passes when at least one discovered install is both `usable` and `supported`
(`RInstallation`, `r-installation.ts:217-242`; supported means `>= MINIMUM_R_VERSION`, currently
4.2.0 from `package.json` via `constants.ts:16`).

Fails when none is. The detail names the best rejected install and its `friendlyReason`
(`r-installation.ts:172-212`).

No fix: there is no install-R command anywhere in the repo, unlike Python's
`python.installPythonViaUv`. Sets `learnMoreUrl` to
`https://positron.posit.co/r-installations` instead -- the field the Python schema already reserves.

### 3. `environmentReady`

Evaluates the preferred R from `getPreferredRuntime('r')`.

When there is no preferred runtime, or its `binpath` matches no discovered `RInstallation`, the
probe throws and `runItem` converts it to a `fail` with the error message -- the same way Python's
`evaluateReady` throws "No interpreter to evaluate". Item 2 having passed means a usable R exists,
so reaching this state indicates a real inconsistency worth reporting rather than papering over.

Gates in order:

1. fail -- `RInstallation.usable` is false; detail reports `reasonRejected`
2. fail -- version below `MINIMUM_R_VERSION`
3. fail -- ark kernel binary unresolvable (`getArkKernelPath()` returns undefined, `kernel.ts:44`)
4. fail -- `libR` shared library missing (see below)
5. warn -- R architecture differs from the ark binary's architecture

Gates 4 and 5 are new signals. positron-r has no `libR` check anywhere today, and architecture
mismatch currently only logs a warning (`r-installation.ts:371-378`) without affecting usability.

Gate 3 precedes gate 4 because resolving the libR path needs ark's architecture (below), so ark must
be located first.

Gate 5 is a `warn`, so it does not flip `ok` to false. It is the closest analog to Python's Rosetta
warn.

#### Resolving the libR path

Mirror ark's own resolution exactly. Ark is the process that loads the library, so its layout
assumptions are the only ones that matter. From `harp::find_r_shared_library_folder`:

| platform | folder | file |
|---|---|---|
| macOS | `<R_HOME>/lib` | `libR.dylib` |
| Linux | `<R_HOME>/lib` | `libR.so` |
| Windows, x64 ark | `<R_HOME>/bin/x64` | `R.dll` |
| Windows, arm64 ark | `<R_HOME>/bin` | `R.dll` |

Two things here are easy to get wrong:

- **Windows arm64 uses a flatter layout, `bin/R.dll`, not `bin/arm64/R.dll`**
  (`crates/harp/src/sys/windows/library.rs:107-117`). Windows-on-ARM R is a supported configuration
  -- `r-installation.ts:361-371` has explicit arm64/aarch64 detection added for #15297 -- so a
  hardcoded `bin/x64/R.dll` would report libR missing on a healthy arm64 install.
- **The Windows folder is chosen by ark's architecture, not R's.** In ark that choice is
  `#[cfg(target_arch)]`, resolved when ark is compiled. The health check must therefore key off the
  ark binary's architecture, which is also what gate 5 compares against.

This gate is also, in effect, the `--enable-R-shlib` check: ark panics with exactly that advice when
the library is absent (`crates/harp/src/library.rs:65`). Reporting it as a health item turns that
crash into a diagnosable item.

**Testability requirement.** Path resolution is a pure function of `(rHome, platform, arkArch)`,
with platform and architecture passed in as arguments rather than read from `os.platform()` inside:

```ts
export function resolveLibRPath(rHome: string, platform: NodeJS.Platform,
                                arkArch: 'arm64' | 'x64' | undefined): string
```

Existence checking stays separate, in the caller. This matters because three of the four rows in the
table above cannot be exercised on any single developer machine -- the whole gate would otherwise be
verified only by the one row the author happens to run on, and the Windows arm64 row is exactly the
one that was wrong in the first draft of this design.

#### Architecture sources for gate 5

R's architecture is read from `RInstallation.arch`, never re-sniffed. That field is already computed
through a layered strategy -- DESCRIPTION `Built:` parsing, then PE-header sniffing on Windows and
Mach-O sniffing on macOS (`r-installation.ts:341-390`). Duplicating it would create logic that
drifts.

Ark's architecture needs no new detection code. Both existing sniffers are exported and take an
arbitrary binary path, so they are pointed at the resolved ark binary rather than at R:

- Windows: `sniffWindowsBinaryArchitecture(arkPath)` (`kernel.ts:268`), PE header
- macOS: `sniffMachOBinaryArchitecture(arkPath)` (`kernel.ts:352`), Mach-O header
- Linux: gate 5 is skipped, and the libR folder is unconditionally `<R_HOME>/lib`

Note `determineWindowsKernelArch` (`kernel.ts:132`) is *not* the accessor to use. Despite the name
it reports the architecture of **R**, not of ark, and exists so `resolveWindowsEmbeddedKernel` can
pick the ark subdirectory matching R. Using it for gate 5 would compare R against itself and never
fire.

That Windows selection also explains why gate 5 is still worth running there even though ark is
normally chosen to match R: `getWindowsSearchOrder` falls back to other subdirectories, and then to
`resources/ark/ark.exe`, when the preferred one is absent (`kernel.ts:103-124`). A mismatch is
therefore reachable, just rarer than on macOS.

The two sniffers return different vocabularies -- `'arm64' | 'x64'` versus `'arm64' | 'x86_64'` --
and `RInstallation.arch` uses the latter. Normalize before comparing, reusing `normalizeWindowsArch`
(`kernel.ts:166`), and treat an undetectable architecture on either side as "no warn" rather than a
mismatch: a failed sniff is missing information, not evidence of a problem.

### 4. `dedicatedEnvironment`

renv is the analog of a dedicated Python environment.

Detection is path-based: `renv.lock` or `renv/activate.R` in the workspace folder. The existing
runtime detector `RPackageManager._detectRenv()` (`packages.ts:372-387`) needs a live session, so it
cannot be used here.

- pass -- a folder is open and has an renv project
- fail -- a folder is open with no renv project; fix: Initialize renv (`r.renvInit`)
- warn -- no folder is open; fix: New Folder from Template
  (`positron.workbench.action.newFolderFromTemplate`)

This drops Python's `anyDedicatedDiscovered` branch. Python can enumerate every discovered venv;
there is no global index of renv projects on disk, so the no-folder case is a flat `warn`.

**Multi-root workspaces.** Only the first workspace folder is inspected
(`vscode.workspace.workspaceFolders?.[0]`), matching what the Python check does with
`resolveWorkspaceUri` (`environmentHealth.ts:534-539`). The command also accepts an optional
`workspaceFolder` URI-string argument so a future frontend can ask about a specific root. The
reported item names the folder it evaluated, so the answer is never ambiguous even though it is
partial. Reporting per-root health is a frontend concern and is out of scope here.

## Command surface

`r.getEnvironmentHealth` returns the result object. Registered in `commands.ts`, not declared in
`contributes.commands` -- it is an internal API for the future frontend, like `r.renvInit` and
`r.getMinimumRVersion`.

`r.printEnvironmentHealth` is the developer probe. Declared in `contributes.commands` with category
`R` and a title in `package.nls.json`. Calls the above, then `LOGGER.show()` and logs the JSON
between `[START]` / `[END]` markers, following both the Python command and the existing
`r.interpreters.settingsInfo` pattern (`commands.ts:255-258`).

The full wire format. `HealthItemStatus`, `HealthItemFix` and `HealthItem` are structurally
identical to their Python counterparts (`environmentHealth.ts:41-66`); only the result wrapper
differs, where Python has `interpreterPath`:

```ts
type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

type HealthItemId = 'discovery' | 'rInstalled' | 'environmentReady' | 'dedicatedEnvironment';

interface HealthItemFix {
    commandId: string;   // extension or core command id
    args?: unknown[];    // fully computed at check time; plain JSON only
    label: string;       // localized button label
}

interface HealthItem {
    id: HealthItemId;
    status: HealthItemStatus;
    summary: string;      // localized one-liner
    detail?: string;      // localized, with actual paths and versions
    fix?: HealthItemFix;
    learnMoreUrl?: string;
}

interface REnvironmentHealthResult {
    ok: boolean;          // true when no item is 'fail'; 'warn' does not flip it
    items: HealthItem[];  // always all four, in dependency order
    rBinPath?: string;
    rHome?: string;
}
```

Strings are localized with `vscode.l10n.t`, the convention in this extension.

## Error handling

The command never rejects. Each probe runs inside a `runItem` wrapper that converts a throw into a
`fail` item carrying the error message, matching Python's contract. A frontend can therefore always
render a report.

## Supporting change: harden `r.renvInit`

`r.renvInit` does not work without a running R session (`commands.ts:236-251`), and a health check is
exactly the moment when no session is running.

The failure mode is worth stating precisely, because the code reads misleadingly. The command's
visible no-session branch is `console.debug('[r.renvInit] no session available')` -- but control
never reaches it. `checkInstalled` runs first, and it resolves its own session via
`RSessionManager.instance.getConsoleSession()` and **throws** when there is none:
`Cannot check install status of renv; no R session available` (`session.ts:1216-1224`). So today the
command rejects with an unhandled error, and its `console.debug` branch is dead code for this case.

This drives the step order below: the session must be established *before* `checkInstalled`, not
after.

It gets changed to start an R session when none is running, and to surface a real error instead of
`console.debug`. There is precedent: the Python PR modified `python.createEnvironmentAndRegister` to
accept a URI-string `workspaceFolder` so its fix button would work across the command boundary.

This also fixes an existing latent bug for the command's current caller. The New Folder flow invokes
it at `positronNewFolderService.ts:623`, where the session may not be up yet either.

**This must land in the same PR as the health check.** Shipped separately, the
`dedicatedEnvironment` fix button silently does nothing -- precisely the defect the hardening
exists to remove.

### Specified behavior

Ordered, so an implementer has no open questions:

1. `session = await positron.runtime.getForegroundSession()`. If defined, skip to step 4. The
   existing path is then unchanged, so nothing about the current New Folder behavior regresses when
   a session is already up.
2. No session: resolve the runtime with `positron.runtime.getPreferredRuntime('r')` -- the same
   source the health check uses, so the button acts on the R the report just described. If it
   returns undefined, throw; there is no R to initialize renv with.
3. `await positron.runtime.selectLanguageRuntime(metadata.runtimeId)`, then poll
   `getForegroundSession()` until it resolves to a session or a bounded timeout elapses.

   The poll is required, not defensive padding. `selectLanguageRuntime` resolves through a bare
   proxy call (`extHostLanguageRuntime.ts:1749-1751`) and its contract says "select and start"; it
   does not promise the session is ready. Executing `renv::init()` on the strength of that
   resolution would race startup. On timeout, throw.

   `selectLanguageRuntime` shuts down other active runtimes for the language, which is acceptable
   only because this branch runs exclusively when there is no session.
4. `checkInstalled('renv', MINIMUM_RENV_VERSION)`, now guaranteed a session. If it returns false the
   user declined the install prompt: return quietly, no error. That is a choice, not a failure.
5. `session.execute('renv::init()', ...)` exactly as today.

Failures in steps 2 and 3 throw with a message naming the cause. The two existing callers differ in
how that surfaces: the health-check fix button
is invoked by a frontend that can show it, while `positronNewFolderService` currently ignores the
result. Making the failure visible there is out of scope; the error is logged to `LOGGER` regardless
so it is at least diagnosable.

## Testing

`extensions/positron-r/src/test/environmentHealth.unit.test.ts` -- Mocha TDD plus sinon, matching the
extension's existing `*.unit.test.ts` files. positron-r tests run in the extension host.

Because every `probe*` function takes a plain deps object, the four probes and the `assembleItems`
cascade test with no filesystem and no session. The two filesystem-touching helpers (libR lookup,
renv detection) get tmpdir fixtures, following `sniff-macho.unit.test.ts` and `rootSignature.test.ts`.

Coverage of the health check:

- each probe's status branches, including every ordered gate in `environmentReady`
- the short-circuit cascade: a fail at item 1 skips 2 through 4, a fail at 2 skips 3 and 4, and so on
- `ok` is false only for `fail`, not for `warn`
- a throwing probe yields a `fail` item rather than rejecting the command
- libR path resolution per platform and per ark architecture, including the Windows arm64 flat
  layout -- a table-driven test over the four rows above, since that is the gate most likely to be
  wrong and least likely to be caught by hand-testing on one machine

Coverage of the `r.renvInit` hardening, the one live behavior change here:

- a session already running: `getForegroundSession` is used and no runtime is started, proving the
  existing New Folder path does not regress
- no session: the preferred runtime is selected and `renv::init()` executes only after a session
  becomes available
- no session and no preferred runtime: throws a message naming that cause, rather than the current
  misleading `Cannot check install status of renv`
- session never becomes available: throws on timeout, rather than executing into the void
- renv install declined: returns quietly with no error
- `checkInstalled` is never called before a session exists -- the ordering guard that keeps the
  command from reproducing today's misleading throw

These use a stubbed `positron.runtime` surface, following the fake-session approach in
`packages.unit.test.ts:22`.

Run with `npm run test-extension -- -l positron-r --grep "environment health"`.
