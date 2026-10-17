# Stop R from auto-starting in folders with no R files (#16376)

- **Issue:** https://github.com/posit-dev/positron/issues/16376
- **Code read from:** `origin/main` at `fb9df6b77d`. Line numbers below are from that commit.
- **Branch:** a new branch from `main`. The earlier branch `dhruvi/discovery-cache-startup-flag` is not used.
- **Step numbers** follow [interpreter-startup-today.md](interpreter-startup-today.md). Each time a folder opens, core runs these steps in order:
  1. Reconnect consoles that are still running.
  2. Start affiliated runtimes.
  3. Start recommendations.
  4. Find interpreters.
  5. Start after the search. If no console is running and no language has an affiliated runtime, this step starts the first interpreter whose `startupBehavior` is `immediate`.

## Terms

- **Core:** Positron's own code, as opposed to the language extensions (`positron-r`, `positron-python`).
- **Interpreter record:** what core keeps about one interpreter: its path, its version, its runtime ID, and a few settings. The code calls it runtime metadata. The **runtime ID** is a hash of the path and the version, and it identifies the interpreter.
- **`startupBehavior`:** a field on the interpreter record. It tells core when core may start that interpreter on its own:
  - `immediate`: as soon as the folder opens
  - `implicit`: when you open a file for its language or run code
  - `explicit`: only when you pick it
- **Interpreter search:** each extension's code that lists every interpreter on the machine for its language. Core runs it in step 4. The code calls it discovery.
- **Discovery cache:** core saves the records each search returns, so the next launch can skip the search. There's one cache for the whole app, and every folder and window shares it. When the cache is up to date, the search doesn't run, and core loads the records from the cache instead.
- **Registering:** adding an interpreter record to core's list for this window. The interpreter picker shows that list.
- **Recommendation:** each extension's answer to "which interpreter fits the folder that's open?" (`recommendedWorkspaceRuntime()`). Core asks for it in step 3 and never saves it in the cache.
- **Affiliated runtime:** the interpreter Positron remembers for a language in this folder. Core saves it when that language's console is the one shown in the Console pane. Step 2 starts it the next time the folder opens.
- **Current R:** the machine's default R, for example the one that runs when you type `R` in a terminal.
- **Usable R:** an R installation that R's own checks accept: a real install, new enough, and not excluded by `positron.r.interpreters.exclude`.
- **`validateMetadata()`:** an extension method. Core calls it to check that a saved interpreter record still works, and the extension returns a fresh record.

## Summary

R can start in a folder that has no R files. It happens when the discovery cache was last filled while a folder with R files was open.

The fix moves the decision "should R start as soon as this folder opens?" out of R's interpreter search and into R's recommendation:

- The cache shares the search's records with every folder, so a decision the search made for one folder gets reused in others.
- Core asks for the recommendation fresh in each folder, and never caches it.

Then core stops the cache from storing `immediate` at all. That rule protects every language.

## The problem

R's interpreter search sets `startupBehavior` to `immediate` on the first R it lists when the open folder looks like an R project. Whether the folder looks like an R project is a fact about the folder, but it's stored on the interpreter's record.

The discovery cache stores one record per interpreter path, once for the whole app (`StorageScope.APPLICATION`, `runtimeDiscoveryCache.ts:168`). So the `immediate` value goes wherever the record goes.

Example, with default settings and an empty cache:

1. Open `r-project`, which has `analysis.R`. R's search runs, sees the R file, and sets R 4.4.1's `startupBehavior` to `immediate`. The cache saves the record with that value.
2. Open `new-folder`, which has only a README and has never been opened. The cache is up to date, so R's search is skipped. Core registers R 4.4.1 from the cache, still set to `immediate`.
3. Step 5 sees no affiliated runtime and no console. It starts the first interpreter set to `immediate` (`runtimeStartup.ts:316-391`). R starts in a folder with no R files.

Nothing checked `new-folder` for R files. The answer came from `r-project`.

### Three ways `immediate` gets into the cache

1. **R's search** sets `immediate` on the first usable R (`provider.ts:327-336`). During a search, core writes every record the search returns into the cache (`runtimeStartup.ts:793-818`).
2. **R's `validateMetadata()`** always returns a record set to `immediate` (`runtime-manager.ts:398`). When a cached interpreter's file changes, for example after an upgrade, core rechecks the record in the background with `validateMetadata()`. It writes the result back into the cache (`runtimeStartup.ts:1517-1572`). If the runtime ID changed, core also registers the new record. An interpreter set to `immediate` that's registered after step 5 starts if no console is running (`runtimeStartup.ts:400-411`).
3. **Records that today's builds already saved** still have `immediate`.

Python has the same problem. Its search sets `immediate` on its first interpreter when the folder has Python files (`discoverer.ts:78-112`). It only affects the Pythons the cache stores:

- Cached: Pythons installed for the whole machine, conda environments, and pyenv versions.
- Not cached: virtual environments, and anything inside the open folder.

### Why we can't just stop storing `immediate`

Reusing the cached value is also what makes R start in new R projects today. Open `r-project-2`, which has R files and has never been opened, while the cache is up to date. The cached `immediate` happens to be right for this folder, so R starts.

If the cache stopped storing `immediate` and nothing else changed, R would stop auto-starting in new R projects whenever the cache is up to date. That's most launches.

So something has to decide, on every launch and for the folder that's open, whether R should start right away. R's recommendation can do that:

- Core asks for it in step 3, on every launch where no console has started yet.
- Core registers it directly and never writes it to the cache (`runtimeStartup.ts:1804-1853`).

## The fix

### PR 1: R's recommendation decides whether R starts right away

This PR changes positron-r only. Core doesn't change.

**R's recommendation.** Today it returns the pinned R set to `implicit`, or nothing (`runtime-manager.ts:147-168`). After:

```ts
async recommendedWorkspaceRuntime() {
	if (definitionsOnly()) { return undefined; }

	// Pinned R: unchanged in this PR. The #2659 PR changes this part.
	const pinned = readPinSetting();
	if (pinned && fileExists(pinned)) {
		return makeMetadata(pinned, 'implicit');
	}

	try {
		// Checked in the folder that's open now, on every launch. The cheap check goes first.
		if (!(await looksLikeRProject())) { return undefined; }

		const r = await pickStartupR();
		return r ? makeMetadata(r, 'immediate') : undefined;
	} catch (err) {
		// Core asks every language at once and waits for all of them. A throw
		// here would lose every language's recommendation, not just R's.
		log(err);
		return undefined;
	}
}

// Picks the same R as the search: the current R if it's usable, otherwise
// the highest usable version.
async function pickStartupR() {
	const current = (await currentRBinaryCandidates())[0];
	if (current && !overrideListSet() && !rVersionsFileExists() && !modulesConfiguredForR()) {
		// Every other R sorts after the current R, so listing conda and pixi
		// environments can't change the answer. A file check tells whether the
		// current R itself lives inside a conda or pixi environment.
		const inst = new RInstallation(current.path, true, current.reasons, packagerMetadataForPath(current.path));
		if (inst.usable) { return inst; }
	}

	// Otherwise use the same list, filter, and order the search uses. With conda,
	// pixi, r-versions, or module discovery on, this runs those programs.
	const installs = (await discoverRInstallations())
		.filter(r => r.usable)
		.sort(compareRInstallations);
	return installs[0];
}
```

Details:

- `looksLikeRProject()` is today's `shouldRecommendForWorkspace()` (`provider.ts:1337-1361`). It returns true when the folder has R files at any depth, or when the folder is empty and you used RStudio in the last 30 days.
- The search for R files used to run only when the cache was out of date, in step 4. Now it runs in step 3, on every launch where no console has started. To keep it fast, it skips these folders, which hold installed packages and environments rather than your own code: `node_modules`, `.venv`, `venv`, `.virtualenv`, `.conda`, `.pixi`.
- The empty-folder check still skips only `node_modules`. Otherwise a folder holding only `.venv` would count as empty, and an RStudio user would get R started there.
- `compareRInstallations()` is the search's sort order (`provider.ts:312-320`), moved into its own function so the search and the recommendation share it.
- The full search can be slow, because with some settings on it finds R by running other programs. `pickStartupR()` skips the full search only when the answer can't differ from what the search would pick. It runs the full search when:
  - `positron.r.interpreters.override` is set. That setting limits R to the paths it lists, so the search ignores the current R and lists only those paths (`provider.ts:409-413`). That search is fast.
  - an r-versions file exists. That's a file listing R installations, used on Posit Workbench servers. It can add settings for starting the current R, such as a module to load or environment variables.
  - environment modules are set up for R. Environment modules are a Linux tool that servers use to load software. Those R installations can only be found by running module commands, and those servers often have no current R.
  - there's no current R, or it isn't usable. Then the search picks the highest usable version, which needs the full list.
- The quick path builds the current R's record with the same path and version the search would use, so the record gets the same runtime ID.
- When the cache is out of date, step 3 and step 4 both run the R search in the same launch. Share one search per launch, so conda, pixi, and module commands only run once.

**R's search** never sets `immediate`:

```ts
for (const inst of sortedInstalls) {
	yield makeMetadata(inst, 'implicit');
}
```

**R's `validateMetadata()`** keeps the `startupBehavior` the saved record had:

```ts
return makeMetadata(inst, saved.startupBehavior);   // was: 'immediate'
```

**Clear the old records.** Add a version field to R's settings digest (`getRFilterSettingsDigest()`, `provider.ts:234`). The digest is a hash of the R settings that affect what the search finds. Core compares it at each launch. When it changes, core treats R's cached records as out of date and runs R's search again. So the first launch after upgrading runs a full R search, and the search rewrites every cached R record with `implicit`. Isabel's Python design does the same thing for Python.

After PR 1:

- `new-folder`: R's recommendation returns nothing, and R 4.4.1 comes from the cache set to `implicit`. Step 5 starts nothing.
- `r-project-2`: the recommendation returns R set to `immediate`, and step 3 starts it.

### Python: Isabel's #15825 Python PR

Isabel's design ([python-startup-policy-design.md](python-startup-policy-design.md)) already makes the same change for Python:

- the search sets every interpreter to `explicit`
- the recommendation decides what starts
- a policy version is added to Python's settings digest, so Python's old cached records get rewritten too

That fixes the Python half of 16376. This plan only adds one test request for her PR (see Tests).

### PR 2: core never stores `immediate` in the cache

This is a rule in core that protects every language, including language extensions that aren't part of Positron.

```ts
// runtimeDiscoveryCache.ts, upsert()
if (record.startupBehavior === 'immediate') {
	record = { ...record, startupBehavior: 'implicit' };
}

// runtimeStartup.ts, revalidateOne(), after validateMetadata() returns
if (fresh.startupBehavior === 'immediate') {
	fresh = { ...fresh, startupBehavior: 'implicit' };
}
```

`upsert()` is the function that writes a record into the cache. `revalidateOne()` is the background recheck described in "Three ways `immediate` gets into the cache".

There's no cache version bump. By the time PR 2 lands, R's and Python's digest changes will already have rewritten their records.

## Behavior changes

**Folders with both R and Python files**

- Step 3 starts every recommendation set to `immediate` (`runtimeStartup.ts:1828-1834`). Today R never starts from step 3.
- Today, in a folder with both kinds of files and a `.venv` at its top level, only Python starts. Without a `.venv`, step 5 starts whichever language's interpreter was registered first.
- After PR 1, R starts in step 3 in both cases, so a folder with both kinds of files and a top-level `.venv` gets both consoles.
- After Isabel's Python PR, Python's recommendation is also set to `immediate` in any folder with Python files. Then every folder with both kinds of files starts both consoles.
- Only the console shown in the Console pane gets saved as the affiliated runtime. So on later opens, only the language you used starts, unless you used both.
- Decided: accept this. Projects with both kinds of files should be rare. We don't control which console is shown first, and we'll revisit only if users report it.

**Step 3 waits longer in folders with no affiliated runtime**

- Core asks every language for its recommendation at the same time and waits for all of them (`extHostLanguageRuntime.ts:1243-1264`). So the slowest language decides how long step 3 takes.
- R now adds its search for R files to that wait.
- When `pickStartupR()` runs the full search, R also adds the time to run the programs those settings turn on (`conda env list --json`, `pixi info --json`, module commands). They list every R before R picks one. The R it picks is still the first in the search's order: the current R if there is one, otherwise the highest version. It doesn't prefer the project's own conda or pixi R. Pinning that path (#2659) does that.
- Most conda and pixi users have a current R, so they skip the full search and don't wait.
- Decided: accept the wait for the rest: users with no usable current R, with environment modules, or with an r-versions file.

**The first launch after upgrading runs a full R search**, because the digest changed.

**No change:**

- folders with a pinned R
- folders with an affiliated runtime
- `interpreters.startupBehavior` set to `manual`, because core refuses to auto-start there (`runtimeSession.ts:1747-1755`)

## Order of PRs

Open the PRs and do the work now. Merge them in this order, as each one's dependencies land. Each PR description states the merge order and what it waits for.

1. **PR 1 (R).** Branch from `main`. It depends on nothing, so it can merge once it's reviewed. It fixes 16376 for R.
2. **Isabel's #15825 core PR.** Not opened yet. It doesn't depend on PR 1, and PR 1 doesn't depend on it.
3. **Isabel's #15825 Python PR.** Merges after her core PR. It fixes 16376 for Python.
4. **PR 2 (core rule).** Branch from `main`. Merges after PR 1 and Isabel's Python PR.
5. **#2659 PR.** Merges after PR 1 and both of Isabel's PRs. Its R change needs `recommendationIsProjectDefault`, which comes from Isabel's core PR, so that part has to be built on her branch once it exists.

PR 2 waits for Isabel's Python PR:

- Until her PR lands, Python's recommendation only sets `immediate` in folders with an environment such as `.venv` at the top level. In a new Python project that only has a machine-wide Python, Python auto-starts when the cache is up to date only because the cached `immediate` happens to be right for that folder.
- Merging PR 2 first would remove that start for Python users until her PR lands.

#2659 waits for PR 1:

- Both PRs edit R's recommendation and search. Landing PR 1 first means #2659 builds on it instead of conflicting with it.
- Q13 in the #2659 plan promises that nothing starts ahead of a pinned R. That only holds once no cached R record has `immediate`, which PR 1 makes true.
- PR 1 already stops R's search from setting `immediate`, which is one of the changes in Q13. #2659 then only changes the part of the recommendation that handles a pinned R, and one setting:
  - return the pinned R set to `immediate` when `looksLikeRProject()` is true, otherwise set to `implicit`
  - set `recommendationIsProjectDefault: false`, which is Isabel's core change 1. It stops core from saving R's recommendation as an affiliated runtime before that R has ever started.

## Tests

### PR 1

**Vitest**, in a new file next to the existing positron-r Vitest files, such as `extensions/positron-r/src/startup-choice.vitest.ts`. It tests a pure function, with no `vscode` import, that picks the R and its `startupBehavior`. Cases:

- no pin, R project, current R installed: returns the current R, `immediate`
- no pin, R project, no current R: returns the highest version, `immediate`
- two installs with the same version: returns arm64 before x86_64
- no pin, not an R project: returns nothing
- no pin, R project, no usable R: returns nothing
- pin set: returns the pinned R, `implicit`, whether or not it's an R project

The same file tests when `pickStartupR()` may skip the full search:

- usable current R, conda and pixi on: skips it
- no current R: runs it
- current R not usable: runs it
- override list set: runs it
- r-versions file exists: runs it
- modules set up for R: runs it

**Extension host** tests (Mocha, `npm run test-extension -- -l positron-r`). They need a real R, which the PR's CI runs have on Linux.

- The search returns no record set to `immediate`.
- `validateMetadata()` returns `implicit` for a record set to `implicit`, and `immediate` for a record set to `immediate`.
- On a machine with a current R, the quick path and the full search return the same runtime ID.

**E2E**, one test file in `test/e2e/tests/interpreters/`, with `interpreters.startupBehavior` set to `auto`:

1. Open a folder with an R file, clear the interpreter cache, and reload. R starts.
2. Open a never-opened folder with only a README. No R session starts. This is 16376.
3. Open a never-opened folder with an R file. R starts while the cache is up to date.

This is the only test that runs the real R extension with the real cache across folders. Wait for discovery to finish before checking that no session started. A fixed sleep would be flaky.

### PR 2

**Vitest**, in `src/vs/workbench/services/runtimeStartup/test/common/`:

- `runtimeDiscoveryCache.vitest.ts`:
  - `upsert()` of a record set to `immediate` reads back as `implicit`, with every other field unchanged.
  - `implicit`, `explicit`, and `manual` are stored as given.
- `runtimeStartup.vitest.ts`, using the existing `revalidateOne` helper: when the validator returns `immediate`, the cache entry and the registered runtime are both `implicit`.
- `runtimeStartup.vitest.ts`, two launches against the real cache, built like the `launch()` helper in the "expired cache entries" suite:
  - Launch 1 runs a full search, and the fake runtime manager (the test's stand-in for an extension) returns a record set to `immediate`.
  - Launch 2 starts with the cache up to date, and its recommendation returns nothing. After discovery completes, `autoStartRuntime` was never called. This is 16376 at the core level.
- The same setup, except launch 2's recommendation returns a record set to `immediate`. It starts with the `ExtensionRecommendedRuntime` start reason. This makes sure the way PR 1 starts R keeps working.

### Isabel's Python PR

Ask for one test: Python's search returns no record set to `immediate`.

## Manual checks

- The 16376 steps: R doesn't start in `new-folder`.
- `r-project-2` while the cache is up to date: R starts. The console info popup shows the extension's recommendation as the start reason.
- `positron.r.interpreters.condaDiscovery` on, in a new R project, on a machine with a current R: the current R starts, and the R log shows no `conda env list` call from the recommendation.
- A folder with R files and a top-level `.venv`: both consoles start. This is an expected change.
- A folder with a pinned R: same behavior as today.
