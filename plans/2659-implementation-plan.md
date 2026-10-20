# Pinned interpreters (#2659): implementation plan

- **Decisions:** [2659-pinned-interpreter.md](2659-pinned-interpreter.md). This doc says how to build them. It doesn't repeat why.
- **Code read from:** `origin/main` at `fb9df6b77d`. Line numbers below are from that commit.
- **Ships as:** one PR for #2659, stacked on 16376 PR 1's branch. It merges after 16376 PR 1 and both of Isabel's #15825 PRs. [16376-discovery-cache-startup.md](16376-discovery-cache-startup.md) has the merge order.
- **Build order:** 16376 PR 1 first, then #2659's commits 1 to 6, then commits 7 to 9 once Isabel's core PR exists. "Build order and review" below has the details.
- **Where these docs live:** on the branch `dhruvi/2659-pinned-interpreter-plan`, not on `main`. From an implementation branch, read them with `git show origin/dhruvi/2659-pinned-interpreter-plan:plans/<file>`.
- **Step numbers** follow [interpreter-startup-today.md](interpreter-startup-today.md). Each time a folder opens, core runs these steps in order:
  1. Reconnect consoles that are still running.
  2. Start affiliated runtimes.
  3. Start recommendations.
  4. Find interpreters.
  5. Start after the search.

## Terms

- **Core:** Positron's own code in `src/vs`, as opposed to the language extensions (`positron-r`, `positron-python`).
- **Extension host:** the separate process extensions run in. Core can't call extension code directly. It sends a message to the extension host, which calls the extension and sends the answer back. The messages each side can send are declared in a shared interface, called the protocol.
- **Runtime manager:** the object each language extension registers with core through `positron.runtime.registerLanguageRuntimeManager()`. Core asks it to list, recommend, check, and start that language's interpreters.
- **Runtime metadata:** the record core keeps for one interpreter: its path, version, name, and a few settings. The **runtime ID** is a hash of the path and the version.
- **`startupBehavior`:** a field on the runtime metadata that tells core when core may start the interpreter on its own:
  - `immediate`: as soon as the folder opens
  - `implicit`: when you open a file for its language or run code
  - `explicit`: only when you pick it
- **Affiliated runtime:** the interpreter Positron remembers for a language in this folder. Core saves it, with a last-started time and a last-used time, when that language's console is the one shown in the Console pane. Step 2 starts it the next time the folder opens.
- **Recommendation:** each extension's answer to "which interpreter fits the folder that's open?" (`recommendedWorkspaceRuntime()`). Core asks for it in step 3.
- **Registering:** adding runtime metadata to core's list of interpreters for this window. The interpreter picker shows that list. Core skips `validateMetadata()` for an interpreter that's already registered.
- **`validateMetadata()`:** a runtime manager method. Core calls it to check that saved runtime metadata still works before it starts that interpreter, and the extension returns a fresh copy.
- **Pinned interpreter:** the interpreter named by `positron.r.interpreters.default` (R) or `python.defaultInterpreterPath` (Python).
- **Pinned check:** the new code in core that asks the extension for its pinned interpreter and writes it over the affiliated runtime.

## What has to land first

None of these exist yet. Isabel's #15825 work has no branch or commits as of 2026-10-16.

- **16376 PR 1 (R).** R's interpreter search stops setting `immediate`. R's recommendation decides whether R starts right away, using a new `looksLikeRProject()` (today's `shouldRecommendForWorkspace()`). #2659 then only changes the part of the recommendation that handles a pinned R. PR 1 also removes R's `default` flag and takes the pin out of R's settings hash. That hash is how core decides whether R's cache is out of date, and the 16376 plan explains it. Switching between pinned projects then no longer runs a full R search.
- **Isabel's #15825 core PR.** Three of its changes matter here:
  - Change 1 adds the `recommendationIsProjectDefault` option. R needs it to stop core from saving R's recommendation as an affiliated runtime before that R has started (Q13).
  - Change 2 makes core remember each recommendation, and start its first matching `interpreters.definitions` entry. "To check during implementation" in the plan depends on it.
  - Change 3 makes `recommended` ignore affiliated runtimes.
- **Isabel's #15825 Python PR.** It ranks `python.defaultInterpreterPath` first at every setting level, so the recommendation and the pinned check pick the same Python. It also adds a lookup that resolves a setting's path without a full interpreter search.

Most of #2659 doesn't need any of this. Commits 1 to 6 below can be built and reviewed now. Commits 7 to 9 wait.

## Build order and review

**Branches:**

- **16376 PR 1:** a new branch from `main`. Build it first. It's small, depends on nothing, and commit 7 below builds on it. What to build and test is in the "PR 1" parts of [16376-discovery-cache-startup.md](16376-discovery-cache-startup.md).
- **#2659:** a new branch stacked on PR 1's branch, managed with `gh-stack` (a GitHub CLI extension that keeps a chain of PRs, each built on the one before, rebased together). #2659's diff then shows only its own commits.
  - Build commits 1 to 6 first. Open the PR as a draft once they're done, so commit 1's new API gets early feedback.
  - Build commits 7 to 9 after Isabel's core PR has a branch. Ask her for one as soon as it exists. Commit 8 is built on it.

**Commits:**

- Each commit does one thing, builds on its own, and adds the tests for its own change. Reviewers can go commit by commit.
- Commits 2 and 4 are split to keep them reviewable:
  - 2a adds the test helper, so 2b's diff is only behavior.
  - 2c and 4a change behavior for users without a pin too, so each stands alone.

**The PR description:**

- a commit-by-commit guide
- the question in [2659-pinned-interpreter.md](2659-pinned-interpreter.md) that each commit implements
- a "How to test" section with the manual checks below

**Tests:** all three kinds are required: unit tests (Vitest and positron-python's unit tests), extension host tests, and one E2E test. The manual checks come on top of those. "Tests" below lists them by commit.

## Commits

### 1. Add `pinnedWorkspaceRuntime()` to the extension API

The new method lives on the runtime manager, next to `recommendedWorkspaceRuntime()`:

```ts
/**
 * The runtime metadata for the interpreter that the language's pin setting
 * names for this workspace, or undefined if no pin is set, the path doesn't
 * lead to an interpreter this extension can start, or a filter setting
 * blocks it. Must not run an interpreter search, and must not return
 * startupBehavior `immediate`.
 */
pinnedWorkspaceRuntime?(): Thenable<LanguageRuntimeMetadata | undefined>;
```

It's optional, so extensions outside Positron keep working without it.

Each layer between the extension and core needs one addition. `getDiscoveryRootSignature()` already takes this path for one extension and one language, so copy it.

- **Extension API:** add the method to `LanguageRuntimeManager` in `src/positron-dts/positron.d.ts`, next to `recommendedWorkspaceRuntime()` (`1231`).
- **Extension host:** add `$pinnedWorkspaceRuntime(extensionId, languageId)` to `src/vs/workbench/api/common/positron/extHostLanguageRuntime.ts`.
  - Find the manager by both language and extension ID, like `$getDiscoveryRootSignature()` (`1218-1230`). Two extensions register a manager for `python`: positron-python and positron-reticulate. Matching on the language alone could pick the wrong one.
  - Don't wait for the manager to register. If no manager matches the extension ID and language, return undefined right away. R and Python register their managers inside `activate()`, and step 3's `$recommendWorkspaceRuntimes()` already relies on that. A wait would also hold up startup for an extension that registers late: positron-javascript registers its manager only when you run its start command (`extensions/positron-javascript/src/commands.ts:83-97`).
  - Return undefined when the manager doesn't have the method. Add `extensionId` to the answer the way `$recommendWorkspaceRuntimes()` does (`1254-1257`). Catch errors and return undefined, so one extension's bug can't stop startup.
- **Protocol:** add the method to `ExtHostLanguageRuntimeShape` in `extHost.positron.protocol.ts`, next to `$getDiscoveryRootSignature` (`163`).
- **Core's interface:** add `pinnedWorkspaceRuntime(extensionId, languageId)` to `IRuntimeManager` in `src/vs/workbench/services/languageRuntime/common/languageRuntimeService.ts`, next to `getDiscoveryRootSignature()` (`1168`).
- **Main thread:** add a method to `MainThreadLanguageRuntime` in `src/vs/workbench/api/browser/positron/mainThreadLanguageRuntime.ts` that forwards to the extension host, like the one at `1866-1868`.

Core has one `IRuntimeManager` for each extension host, and doesn't know which one runs a given extension. Ask every extension host, as `getRecommendedRuntimes()` does (`runtimeStartup.ts:1689-1699`), and use the answer that isn't undefined. A host with no matching manager answers right away, so asking every host costs nothing. Don't use `getHostedLanguageContributions()` to pick the host: it only lists managers that have already registered (`extHostLanguageRuntime.ts:1210-1216`).

positron-reticulate doesn't declare `languageRuntimes` in its `package.json`, so core never activates it for Python, and the check never asks it.

### 2a. Add a test helper that runs the startup sequence

Test-only, in `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.vitest.ts`.

No test drives `startupSequence()` yet. Add a helper that:
- builds `RuntimeStartupService` with fake runtime managers (`makeManager()`, `173-206`) and an affiliated runtime seeded in storage (as the "affiliation healing" tests do, `1206-1219`)
- runs the startup sequence
- waits for it to finish

`startupSequence()` is private (`runtimeStartup.ts:660`), so trigger it the way the service does at startup (`433-466`).

Commits 2b, 2c, 3, and 9 use the helper. It's the largest piece of new test code, so it gets its own commit, and 2b's diff is then only behavior.

### 2b. Run the pinned check after core activates an extension

All in `src/vs/workbench/services/runtimeStartup/common/runtimeStartup.ts`.

**Where it runs.** Inside `activateExtensionsForLanguages()` (`2018-2026`), right after `activateExtension(extension, languageId)` returns. That function already loops over each extension that declares the language, so the check asks each of those extensions in turn. Steps 2, 3, and 4 all activate extensions through this function, so the check runs at every point in the plan's "Where the pinned check runs" table. The function starts the check but doesn't wait for it. Step 2 waits for it before it starts the affiliated runtime, and step 4 waits for it before it loads the cache. Step 3 doesn't wait, because it starts recommendations, not affiliated runtimes.

**Once per language per window.** Keep a map from language ID to the check's promise. The first activation starts the check, and later activations get the same promise. A setting change takes effect on the next launch, as Q5 says, so there's no reason to ask again.

**When it skips the call.** Three cases:

- **The language has no affiliated runtime.** There's nothing to write over, and the recommendation already handles the pin in that case. This also saves Python a lookup in folders Python hasn't been used in.
- **The New Folder flow just picked the interpreter.** When you create a folder with the New Folder flow, core saves the interpreter you picked as the affiliated runtime before step 2 (`runtimeStartup.ts:678-691`). Remember that language, and skip the check for it on this launch. You picked that interpreter on purpose, so it should start. From the next launch on, the check writes the pin over it, the same as for any other pick. Isabel's core change 5 covers settings in the New Folder flow, so check that it follows the same rule.
- **The language's `interpreters.startupBehavior` is `recommended`.** Under `recommended`, the recommendation handles the pin, so there's nothing for the check to do. Read the setting with `getStartupBehavior(languageId)`.

**What the check does:**

1. Ask the extension for `pinnedWorkspaceRuntime(extensionId, languageId)`. If the answer is undefined, stop. The affiliated runtime starts as it does today.
2. If `interpreters.definitions` has entries for that path, build the first one with `getMatchingDefinitions()` and `createInterpreterVariant()` (`interpreterDefinitions.ts:61-84`). This is the Q10 answer.
3. Register the result with `this._languageRuntimeService.registerRuntime()`, the same call step 3 uses for recommendations (`runtimeStartup.ts:1828`). Registering skips `validateMetadata()` when it starts. It also doesn't write to the discovery cache, because only `registerDiscoveredRuntime()` does that (`793-818`).
4. Write it over the affiliated runtime with `saveAffiliatedRuntime()`, keeping the old `lastStarted` and `lastUsed`. Step 2 uses those times to decide which languages to start (`1884-1915`). Keeping them means the pinned runtime is started or skipped the same way the old one would have been.
5. Remember that this language was pinned this launch, for the start reason in commit 3.

**Step 2 has to read the affiliated runtime again.** `startAffiliatedLanguageRuntimes()` reads every affiliated runtime before it activates any extension, then starts the copy it read (`1858-1945`). After the check, it would start the old interpreter. Change both places that start one:

- The first language: after `await this.activateExtensionsForLanguages([languageId])` (`1936`), read `getAffiliatedRuntime(languageId)` again and start that.
- The other languages, which start in the background: do the same inside the `.then()` (`1941-1945`).

**Steps 3 and 4 need no other change.** Step 3 starts the check without waiting for it, as described under "Where it runs". Step 4 waits for activation and the check (`1018`) before it loads interpreters from the cache (`1059`). So when `onDidRegisterRuntime()` checks whether a newly registered interpreter is the affiliated runtime (`1583-1666`), it compares against the pinned one.

**Step 1 needs no change.** Reconnecting a console activates extensions with `activateExtension()` directly, not through `activateExtensionsForLanguages()` (`2116-2120`). The check runs in step 4 instead. Q6 says that's the intended behavior: the console keeps running, and the affiliated runtime goes back to the pinned interpreter for the next launch.

### 2c. Start every `always` language in step 2

In `runtimeStartup.ts`. When two or more languages have an affiliated runtime, step 2 skips one that never started, or wasn't used since it last started (`1884-1915`). Apply that rule only under `auto`. Under `always`, step 2 starts the affiliated runtime of every `always` language, which is the pinned one when a pin is set.

Without this, an `always` language you didn't use last time starts nothing, because step 5 doesn't run while any language has an affiliated runtime (`331`). That's true today too, with or without a pin. This commit changes behavior for users without a pin, so it stands alone.

### 3. Show "pinned" as the start reason

- Add a new value to `SessionStartReasonId`, for example `PinnedRuntime` (`runtimeSessionService.ts:89-192`). The values are saved with each session, so add a new one. Don't rename or reuse an old one.
- Add its label to `sessionStartReasonLabels` in `src/vs/workbench/services/runtimeSession/common/sessionStartReasons.ts` (`52-92`). That map has to list every value, so the build fails until the label exists. The console info popup reads the label (`consoleInstanceInfoButton.tsx:145`).
- Update the inline snapshot in `sessionStartReasons.vitest.ts` (`45-83`), which lists every value.
- Step 2 passes the new reason instead of `AffiliatedRuntime` when the language was pinned this launch.
- Fix the startup message in the Console pane. Step 2 announces the interpreter it's about to start, before it activates the extension (`runtimeStartup.ts:1931-1935`). The Console pane shows that interpreter's name (`startupStatus.tsx:102-108`). With the pinned check, that's the old interpreter. Announce again after the check when the interpreter changed.

### 4a. R: compare paths after following symlinks

Add `arePathsSameFile(a, b)` to `extensions/positron-r/src/path-utils.ts`:
- It calls `fs.realpathSync()` on both paths.
- If that throws, it uses the path as given.
- Then it calls the existing `arePathsSame()` (`path-utils.ts:36-38`), which only compares normalized text.

Use it in the three places that compare a path against the current R today:
- `validateMetadata()` (`runtime-manager.ts:381-382`)
- `registerRuntimeFromPath()` (`410`)
- `rDefinitionOnlyRuntimes()` (`provider.ts:374`), which passes `false` today

This fixes a bug that exists today:
- `currentRBinary()` returns the path with symlinks followed (`provider.ts:998-1002`).
- A macOS `R.framework/Resources` path is only usable as the current R (`r-installation.ts:323-326`).
- So with CRAN's installer and no rig, an R at `/usr/local/bin/R` is rejected as not usable.

This commit changes behavior for users without a pin, so it stands alone.

### 4b. R: `pinnedWorkspaceRuntime()`

In `extensions/positron-r/src/runtime-manager.ts`. Put the work in a helper that the recommendation also uses, so the two can't disagree.

1. If `isDefinitionsOnlyDiscovery()`, return undefined. That's the Q9 rule, the same as the recommendation today (`149-151`).
2. Read the path with `getDefaultInterpreterPath()` (`interpreter-settings.ts:186-197`). It already replaces `${workspaceFolder}`, expands `~`, and ignores relative paths. Return undefined if it's unset or the file doesn't exist.
3. Build the R installation the way `registerRuntimeFromPath()` does (`runtime-manager.ts:409-411`):
   - `current` is true when the path and the current R are the same file, compared with `arePathsSameFile()` from commit 4a. A plain string comparison would drop a pin like `/usr/local/bin/R` on a CRAN install, for the reason 4a gives.
   - When the pin is the current R, build the installation from the current R's path, so its runtime ID matches discovery's entry and the picker doesn't list it twice.
   - Pass `packagerMetadataForPath(path)`, so a pinned R inside a conda or pixi environment starts with that environment activated (Q12).
4. If `!inst.usable`, return undefined. That covers `exclude` and `override` (`r-installation.ts:328-334`), an R that's too old, and a path that isn't a real install (Q9).
5. Return `makeMetadata(inst)`. Its default `startupBehavior` is `implicit` (`provider.ts:724-727`).

This commit doesn't change the recommendation. 16376 PR 1 restructures that function, so commit 7 makes the recommendation use the helper. That keeps commits 1 to 6 buildable before PR 1 lands.

### 5. Python: `pinnedWorkspaceRuntime()`

In `extensions/positron-python/src/client/positron/manager.ts`.

1. Read the value with `getConfiguration('python', firstFolderUri).get('defaultInterpreterPath')`. `get()` returns the value VS Code resolves, in VS Code's order: the folder's value, then the `.code-workspace` value, then the user value. It also returns admin-enforced values, which `inspect()` doesn't show. This is the order Q7 asks for. Today's recommendation uses a different order (`manager.ts:399-402`).
2. Treat `python` as unset, and resolve `${workspaceFolder}` and `~` the way `getUserDefaultInterpreter()` does (`interpreterSettings.ts:499-519`). `resolveSettingPath()` is private to that file (`38-54`), so add an exported helper there that returns the resolved pin.
3. Return undefined if the file doesn't exist. Q8 lists this check as optional, but this commit needs it: without it, a missing path makes Python run a full search before it gives up.
4. Return undefined if `shouldIncludeInterpreter(path)` is false. That applies `python.interpreters.exclude` and `python.interpreters.override` (`interpreterSettings.ts:202-240`).
5. Under `definitionsOnly`, return undefined unless the path is also in `getInterpreterDefinitionPaths()` (`interpreterSettings.ts:121-130`). That's the Q9 rule.
6. Look up the path with `this.interpreterService.getInterpreterDetails(path)`. It resolves one path through the native locator and never starts a full search (`interpreterService.ts:282-284`). Don't use `resolveInterpreterWithRetry()`. On a miss it starts a full refresh and can take about 90 seconds (`positron/util.ts:129-149`).
7. Return `createPythonRuntimeMetadata(interpreter, this.serviceContainer, false)`. With `false`, the `startupBehavior` is `implicit`, or `explicit` without a compatible ipykernel (`positron/runtime.ts:201-216`).

Two side effects to know about:

- `getInterpreterDetails()` adds the environment it finds to Python's list, which fires a `Created` event. Python's manager then registers that interpreter and tells core about it (`manager.ts:222-228`). Core registers the same runtime ID twice, which it ignores.
- The Q5 exception doesn't change. Editing `python.defaultInterpreterPath` mid-session still starts or picks a console right away (`interpreterPathService.ts:70-116`, `manager.ts:164-189`).

### 6. Rewrite both setting descriptions

Both say the setting stops applying once you pick an interpreter. The plan's Summary says they need rewriting.

- **R:** `extensions/positron-r/package.nls.json:49`, key `r.configuration.interpreters.default.markdownDescription`. Today: "Absolute path to the default R binary to use for new workspaces. This setting no longer applies once you select an R interpreter for the workspace." It also says "Requires a restart to take effect", which stays true.
- **Python:** `extensions/positron-python/package.nls.json:67`, key `python.defaultInterpreterPath.description`. Today: "Path to default Python to use when extension loads up for the first time, no longer used once an interpreter is selected for the workspace. Must be an absolute path." Positron already edited this text, so edit it in place. JSON files have no `// --- Start Positron ---` markers.

Suggested meaning for both: the interpreter at this path starts in this workspace at every launch, in place of the interpreter you last used. Picking another interpreter lasts until the next launch. Changes take effect the next time Positron starts in this folder.

### 7. R: start a pinned R right away in R projects (after 16376 PR 1)

On top of 16376 PR 1's recommendation, change only the pinned part:

- Use the helper from commit 4b. That also fixes Q9 and Q12 for the recommendation, which today builds the pinned R without the usable check or the packager metadata (`runtime-manager.ts:159-160`).
- Return the pinned R with `startupBehavior` set to `immediate` when `looksLikeRProject()` is true, otherwise `implicit`. This is the Q13 answer.
- Keep the pinned branch, including `looksLikeRProject()`, inside PR 1's `try`. A throw there would lose every language's recommendation (`extHostLanguageRuntime.ts:1245-1261`), and no console would start on that launch.
- Add the pinned cases to PR 1's decision function and its Vitest file, not a second one.

This needs 16376 PR 1. Without it, R's search still sets `immediate`, and the cache can bring that value into a folder where the pinned R is `implicit`.

### 8. R: stop core from saving R's recommendation as an affiliated runtime (after Isabel's core PR)

Set `recommendationIsProjectDefault: false` on `RRuntimeManager`. Core then stops saving R's recommendation as an affiliated runtime before that R has started (Q13). The option comes from Isabel's core change 1, so this commit is built on her branch.

### 9. Check the items that depend on Isabel's PRs

The plan's "To check during implementation" section lists two:

- Opening an R or Python file starts the pinned interpreter, not the first registered one. That needs her core change 2.
- Under `recommended`, step 4 doesn't start the affiliated runtime. That needs her core change 3.

The tests under "Tests that need Isabel's core changes" check two more: `getPreferredRuntime()` under `recommended`, and step 5 under `always`.

Also check that her Python PR ranks `python.defaultInterpreterPath` first at every setting level. Until it does, a folder with no affiliated Python and a root `.venv` starts the `.venv`, not the pin (`manager.ts:376-402`).

## Tests

**Which commit adds which tests:**

- Commit 1: the extension host tests in `extHostLanguageRuntime.vitest.ts`
- Commit 2a: the startup helper
- Commit 2b: the core cases below, except the `always` case and the start reason case
- Commit 2c: the core `always` case
- Commit 3: the `sessionStartReasons.vitest.ts` snapshot, and the "pinned" start reason case
- Commit 4a: `path-utils.vitest.ts`
- Commit 4b: the R decision tests, and the R extension host tests
- Commit 5: the Python tests
- Commit 7: the pinned cases in 16376 PR 1's decision tests
- Commit 9: the tests that need Isabel's core changes
- Commits 1 to 6 together: the E2E test, once the whole feature works

**How to run them:**

- Vitest: `npx vitest run <file>`. No build daemons needed. Refresh an inline snapshot with `npx vitest run --update <file>`.
- positron-python unit tests: `npm run test:unittests -- --grep "pinnedWorkspaceRuntime"`, after compiling (see `extensions/positron-python/CLAUDE.md`).
- positron-r extension host tests: `npm run test-extension -- -l positron-r`. These need a real R.
- E2E: `npx playwright test test/e2e/tests/interpreters/<file>.test.ts --project e2e-electron`. Run it in the background; one test takes minutes.

### Core (Vitest)

In `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.vitest.ts`. The file already has what these tests need:

- `makeManager()` (`173-206`) builds a fake runtime manager. Add `pinnedWorkspaceRuntime()` to it, returning a chosen answer.
- The "affiliation healing" tests seed an affiliated runtime in storage (`1206-1219`).
- The "start reasons" tests watch `autoStartRuntime()` to see what started and why (`1518-1527`).
- No test drives `startupSequence()` yet. Commit 2a adds a helper that runs it.

Cases:

- Step 2 starts the pinned runtime instead of the saved affiliated runtime. The saved affiliated runtime now holds the pinned one, with the old last-started and last-used times.
- The method returns nothing: the saved affiliated runtime starts, unchanged.
- The language has no affiliated runtime: the method isn't called.
- The New Folder flow picked the interpreter on this launch: the method isn't called for that language, and the picked interpreter starts.
- R is `manual`, so step 3 activates R: the affiliated runtime is updated, and nothing starts.
- A reconnected console: the console keeps running, and step 4 updates the affiliated runtime.
- Steps 2, 3, and 4 all activate the same extension: the method is called once.
- Step 4 loads the old affiliated runtime from the cache: it doesn't start.
- The pinned path has two `interpreters.definitions` entries: the first one is written.
- The pinned runtime is never written to the discovery cache.
- Step 2 uses the "pinned" start reason.
- Two languages, and Python's check is slow: the R console starts before Python's check finishes.
- Under `recommended`: the method isn't called.
- Under `always`, with two languages and one not used last time: step 2 starts both, each with its pin.

Tests that need Isabel's core changes. Each fails until the behavior exists. #2659 merges after her core PR. If her change already makes a test pass, nothing else is needed. If not, #2659 makes the change.

- Under `recommended`, with an old affiliated runtime and a pin set, running code with no console starts the pin, not the old interpreter. The fake runtime manager returns the pin as its recommendation, so the test doesn't depend on Python's ranking. This covers `getPreferredRuntime()`.
- Under `always`, in a new folder with no affiliated runtime and two pinned languages, both pinned interpreters start. This covers step 5 starting each `always` language's recommendation, not the first registered interpreter of one language. `always` set for one language, such as `[r]`, starts that language. `always` set for all languages starts every language.

In `src/vs/workbench/api/test/common/positron/extHostLanguageRuntime.vitest.ts`, which already builds fake managers (`139-273`):

- Two managers registered for `python`: `$pinnedWorkspaceRuntime()` asks the one with the matching extension ID.
- No manager for that extension ID and language: the call returns undefined right away.
- The manager doesn't have the method, or it throws: the call returns undefined.

### R

positron-r has no tests for `runtime-manager.ts` today. Vitest can't load files that import `vscode`, and `runtime-manager.ts`, `provider.ts`, `interpreter-settings.ts`, and `r-installation.ts` all do.

- **Vitest:** put the decision itself in a file with no `vscode` import, next to `packager-detection.vitest.ts`. Given the resolved path, whether it exists, whether it's usable, its packager metadata, and whether the folder looks like an R project, it returns what the method and the recommendation return. Cases: no pin, missing path, not usable, `definitionsOnly`, a pixi path keeps its packager metadata. The R-project cases (`immediate` in an R project, `implicit` elsewhere) go in 16376 PR 1's decision function, in commit 7.
- **Vitest for `arePathsSameFile()` (commit 4a):** a new `path-utils.vitest.ts`. `path-utils.ts` imports only `path`, `os`, and `fs`, so Vitest can load it. Build a temp folder holding a chain of symlinks like the R framework layout (`Resources -> Versions/Current -> 4.6`), the way `packager-detection.vitest.ts` builds its temp folders.
- **Extension host (Mocha),** `npm run test-extension -- -l positron-r`, with a real R. CI's extension host job runs in an image with R 4.5.2 (`.github/workflows/test-ext-host.yml:33-36`). Cases: the method returns R for a pinned real R, and nothing for an excluded one.

### Python

In `extensions/positron-python/src/test/positron/manager.unit.test.ts`, next to the `recommendedWorkspaceRuntime` suite (`416-861`), which already stubs the settings and `createPythonRuntimeMetadata()`. Run with `npm run test:unittests -- --grep "pinnedWorkspaceRuntime"` after compiling (see `extensions/positron-python/CLAUDE.md`).

- unset, or set to `python`: returns nothing
- missing path: returns nothing, and `getInterpreterDetails()` isn't called
- excluded, or outside `override`: returns nothing
- `definitionsOnly`, path not in `interpreters.definitions`: returns nothing
- folder, `.code-workspace`, and user values set: the folder value wins
- `getInterpreterDetails()` misses: returns nothing, and no refresh starts

### E2E

One test in `test/e2e/tests/interpreters/`: a folder whose affiliated runtime isn't the pinned interpreter starts the pinned one on the next open. Use whichever language the CI images have two versions of.

## Manual checks

- R: use R 4.3 in a folder, then pin R 4.4 and reopen. R 4.4 starts. The console info popup says it started because it's pinned. The Console pane's startup message names R 4.4.
- R set to `manual`: nothing starts. Run R code, and R 4.4 starts.
- Pin a path that doesn't exist: the old affiliated runtime starts, and the Python log shows no interpreter refresh.
- A folder with R and Python consoles, R used last: the R console doesn't wait for Python's check (compare times in the logs).
- Two projects pinned to different R installations: switching between them doesn't run a full R search, once 16376 PR 1 has landed (check the R log).
- macOS with CRAN's R installer and no rig: pin `/usr/local/bin/R`, and that R starts. A Mac set up with rig can't show this; use another machine. Commit 4a's Vitest test covers the logic either way.
- `always` set for all languages, with R and Python both saved in the folder and one of them not used last time: both start, each with its pin.
- The New Folder flow: the interpreter you pick starts on the first launch, and the pin takes over from the next one.
- Reload Window with a console running: the console keeps running, and the pin starts on the next fresh open.
- `recommended`, once Isabel's core PR is in: running code with no console starts the pin.

To make these quick to repeat:
- Keep a few test folders outside the repo, each with its own `.vscode/settings.json`: an R project, an empty folder, a folder with both R and Python, and a folder set to `manual`.
- Between runs, reset with Clear Saved Interpreter and by clearing the interpreter cache.

## Open items

- **Python lookups at startup.** A comment in today's recommendation says a lookup that runs before Python's interpreter search can miss (`manager.ts:442-446`). That's why it retries with a full refresh. Commit 5 doesn't retry, so a pin that misses on a cold start falls back to the old affiliated runtime for that launch. Measure how often this happens. Isabel's phase-1 lookup may fix it.
- **Python's recommendation doesn't prefer the pin yet.** Until Isabel's Python PR lands, a folder with no affiliated Python starts a root `.venv` ahead of the pin. If her PR is late, #2659 could move the setting check to the top of today's `recommendedWorkspaceInterpreterPath()` (`manager.ts:362-415`), but her PR rewrites that function.
