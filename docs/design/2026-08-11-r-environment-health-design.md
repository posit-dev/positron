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

**The would-be R comes from core**, via `positron.runtime.getPreferredRuntime('r')`, mapped back to
its `RInstallation` by `binpath`. That is the real answer to "what would start", and it already
accounts for the `positron.r.interpreters.default` setting.

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
3. fail -- `libR` shared library missing (`<R_HOME>/lib/libR.{so,dylib}`, or `bin/x64/R.dll` on
   Windows)
4. fail -- ark kernel binary unresolvable (`getArkKernelPath()` returns undefined, `kernel.ts:44`)
5. warn -- R architecture differs from the ark binary's architecture

Gates 3 and 5 are new signals. positron-r has no `libR` check anywhere today, and architecture
mismatch currently only logs a warning (`r-installation.ts:371-378`) without affecting usability.

Gate 5 is a `warn`, so it does not flip `ok` to false. It is the closest analog to Python's Rosetta
warn.

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

## Command surface

`r.getEnvironmentHealth` returns the result object. Registered in `commands.ts`, not declared in
`contributes.commands` -- it is an internal API for the future frontend, like `r.renvInit` and
`r.getMinimumRVersion`.

`r.printEnvironmentHealth` is the developer probe. Declared in `contributes.commands` with category
`R` and a title in `package.nls.json`. Calls the above, then `LOGGER.show()` and logs the JSON
between `[START]` / `[END]` markers, following both the Python command and the existing
`r.interpreters.settingsInfo` pattern (`commands.ts:255-258`).

Result shape, where Python has `interpreterPath`:

```ts
interface REnvironmentHealthResult {
    ok: boolean;        // true when no item is 'fail'; 'warn' does not flip it
    items: HealthItem[];
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

`r.renvInit` currently calls `getForegroundSession()` and silently `console.debug`s when there is
none (`commands.ts:236-251`). A health check is exactly the moment when no session is running, so
the fix button would appear to do nothing.

It gets changed to start an R session when none is running, and to surface a real error instead of
`console.debug`. There is precedent: the Python PR modified `python.createEnvironmentAndRegister` to
accept a URI-string `workspaceFolder` so its fix button would work across the command boundary.

This also fixes an existing latent bug for the command's current caller. The New Folder flow invokes
it at `positronNewFolderService.ts:623`, where the session may not be up yet either.

## Testing

`extensions/positron-r/src/test/environmentHealth.unit.test.ts` -- Mocha TDD plus sinon, matching the
extension's existing `*.unit.test.ts` files. positron-r tests run in the extension host.

Because every `probe*` function takes a plain deps object, the four probes and the `assembleItems`
cascade test with no filesystem and no session. The two filesystem-touching helpers (libR lookup,
renv detection) get tmpdir fixtures, following `sniff-macho.unit.test.ts` and `rootSignature.test.ts`.

Coverage:

- each probe's status branches, including every ordered gate in `environmentReady`
- the short-circuit cascade: a fail at item 1 skips 2 through 4, a fail at 2 skips 3 and 4, and so on
- `ok` is false only for `fail`, not for `warn`
- a throwing probe yields a `fail` item rather than rejecting the command

Run with `npm run test-extension -- -l positron-r --grep "environment health"`.
