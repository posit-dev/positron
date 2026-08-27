---
name: merge-upstream-vscode
description: This skill should be used when merging upstream changes from vscode-server into the Positron IDE repository. Invoke it when the git repository contains the conflicted changes from an upstream merge.
---

# Merge Upstream VSCode

## Background

Positron is a fork of a project called 'vscode-server'
(https://github.com/rstudio/vscode-server), which is _itself_ a fork of VS Code,
aka Code OSS (https://github.com/microsoft/vscode). vscode-server is a version
of Code OSS that has been customized to run in Posit Workbench (annotated in the
source as PWB). Positron, this repository, is a fork of vscode-server, and runs
in both Posit Workbench and as a standalone desktop app for macOS, Windows, and
Linux.

On a regular basis, changes are merged from Code OSS into vscode-server, and
then from vscode-server into Positron.

The skill is typically invoked in the middle of a cherry-pick merge from
vscode-server into Positron. The working tree is dirty and contains conflicted
changes from the upstream merge.

Your goal is to resolve the conflicts that arise in this second phase until the
code compiles cleanly and passes tests.

## General Principles

### Extension

Positron's main goal is to _extend_ Code OSS with addtional functionality; only
in a few places do we actually need to override or modify the upstream code. So
where genuine conflicts are encountered, your goal should generally be to resolve
them in a way that preserves Positron's changes while still integrating with the
upstream code.

Here is an example:

```
	// extensions/copilot has its own code style
	'!extensions/copilot/**',

	'!src/vs/base/browser/dompurify/**',
	'!src/vs/workbench/services/keybinding/browser/keyboardLayouts/**',
	'!src/vs/workbench/contrib/terminal/common/scripts/psreadline/**',

<<<<<<< HEAD
	// --- Start Positron ---
	'!scripts/positron/**/*',
	// --- End Positron ---
=======
	// Files with licences
	'!src/vs/platform/endpoint/common/licenseAgreement.ts',
>>>>>>> 83301f3f7d9 (Upstream Code OSS changes from 1.124.0 to 1.130.0)
```

In this case, Positron has added an entry to an array in the same place as the
upstream change, so the conflict can be resolved creating a change that preserves
both the upstream and Positron changes.

### Modification

In other places, Positron needs to modify the upstream code to add or change
functionality. In these cases, the conflict can be resolved by accepting the
upstream changes and then reapplying the Positron changes. For example:

```
<<<<<<< HEAD
			// --- Start Positron ---
			.pipe(jsonEditor({ commit, date: readISODate(sourceFolderName), version, positronVersion, positronBuildNumber, quality: releaseChannel }))
			// --- End Positron ---
=======
			.pipe(jsonEditor((json: Record<string, unknown>) => {
				json.commit = commit;
				json.date = readISODate(sourceFolderName);
				json.version = version;
				// Stamp agentSdks from the per-platform results file produced
				// by `build/agent-sdk/produce.ts`. REH-only: REH-web is
				// browser-served and the agent host is node-only, so the
				// SDK config has no consumer there.
				if (type === 'reh') {
					const agentSdks = readAgentSdkResults();
					if (Object.keys(agentSdks).length > 0) {
						json.agentSdks = agentSdks;
					}
				}
				return json;
			}))
>>>>>>> 83301f3f7d9 (Upstream Code OSS changes from 1.124.0 to 1.130.0)
```

Here, Positron has added several fields to the JSON object that are not present
in the upstream code. The correct resolution to this class of conflict is to
accept the upstream change and then reapply the Positron change by adding the
missing fields, matching the new formatting and adding appropriate change
markers..

### Copilot AI commands and menus

Don't add `chatAiFeaturesEnabled` to Copilot's AI commands or menu items by hand.
Positron already gates every command and menu item from `GitHub.copilot-chat`
where the extension points read them, via `gateCopilotContribution` in
`src/vs/workbench/services/actions/common/menusExtensionPoint.ts`, so anything
upstream adds is covered.

- Check that the two Positron-marked call sites in `menusExtensionPoint.ts`
  survived the merge, one on `precondition:` and one on `item.when =`. Nothing
  else does the gating, so if they're gone the gate is gone.
- `test/e2e/tests/assistant/chat-command-palette-gating.test.ts` checks this end
  to end.

## Upstream Divergence

Because vscode-server and Positron merge upstream release branches, it is
frequently the case that merge conflicts arise that are simply conflicts between
two upstream release branches. If a merge conflict arises that contains no
Positron or PWB (Posit Workbench) change markers, it is often a simple conflict
between two upstream release branches that can be resolved by accepting the
upstream changes.

This is especially common in chat/AI related files.

Here's an example:

```
<<<<<<< HEAD
                    "key": "updateModePolicy",
                    "value": "Configure whether you receive automatic updates. Requires a restart after change. The updates are fetched from a Microsoft online service."
=======
                    "key": "updateMode",
                    "value": "Configure whether you receive automatic updates. The updates are fetched from a Microsoft online service."
>>>>>>> 83301f3f7d9 (Upstream Code OSS changes from 1.124.0 to 1.130.0)
```

This is clearly a conflict between two Microsoft changes. Just accept the
incoming (upstream) change.

Note that many `.json` files don't support comments, and therefore don't
contain change markers. In these cases, read the code carefully to determine
which changes need to be preserved.

## Deleted Files

For files that have been changed upstream but deleted in Positron, resolve the
conflict by deleting the file in Positron.

## Github Workflows

Positron doesn't use any Github workflows from upstream. You can ignore or
delete these changes.

## Design Decisions

You will occasionally encounter a merge conflict that requires major, nontrivial
design decisions. If this happens, stop and ask the user how to proceed,
explaining the problem and suggesting solutions while noting the tradeoffs.

## Logs

Write a log file as you work indicating how you resolved each conflict and why,
for the user to review. Place it in the root of the repository, named
'merge-log-X-YYY.txt', replacing X-YYY with the upstream version.

Make a special note of any design decisions you made during the merge that did
not require you to consult the user.

## Committing

Do not make any commits. The user will do so instead.

## Step by step

### Step 1: Review

Review the conflicts in the working tree as a whole to note patterns and any big picture issues.

### Step 2: Resolve

Resolve the conflicts one by one. Once a file is free of conflict markers, stage
(don't commit) it and move on to the next file.

### Step 3: Install

Once all conflicts are resolved, perform a dependency install (npm install). You
may need to `nvm install` first if the change introduces a new Node version.
Stage any lockfile updates. If you see problems, fix them and run `npm install`
again until all lockfile issues are resolved.

Once `npm install` succeeds, run `npm ci` until it passes to confirm that the
lockfile is complete. Do not skip this: a hand-resolved lockfile can leave an
entry that `npm install` reports as "up to date" (it only reconciles against the
node_modules already on disk) while `npm ci` rejects it with an error like
`Missing: <pkg>@ from lock file`. This bites hardest on `overrides` (e.g. the
`sharp` stub), where the merge can nest the override under the wrong package
instead of at the top level. If `npm ci` fails, regenerate the lockfile from
package.json alone with `npm install --package-lock-only` rather than editing it
further by hand, then confirm with `npm ci --dry-run`.

### Step 4: Compile

Once installation is complete, compile the code to check for compile errors:
`npm run compile`.

Once the basic compilation test is passing, verify that you can run a release
build. If you're on macOS: `npm run gulp vscode-darwin-arm64`

### Step 5: Test

Run the unit tests and the extension host tests. Investigate and fix any
failures, and keep running until they pass.

"Unit tests" means BOTH runners, not just one. The Positron vitest suite is fast
and needs no build daemons, so it's tempting to run it and assume units are
covered -- but it does not execute the core Mocha `.test.ts` files, which is
exactly where upstream's own tests collide with Positron's edits. A green vitest
run is NOT evidence that units pass. You must run the core Mocha suite to green
before treating unit tests as done or relying on CI:

```bash
npm run build-start && npm run build-check   # daemons must be green first
npm run test:core                            # the full core Mocha suite
```

Do not push the merge with the core Mocha suite unrun. If the log records units
as "not run yet," they are not done -- CI will find what you skipped. The `test /
unit` CI job runs this suite, so any red here is a red CI job.

These are the recurring ways an upstream `.test.ts` collides with Positron's
edits. Watch for all of them, not just the first:

- **New constructor dependency.** The merge adds a `@IService` parameter to an
  upstream class, and its upstream `.test.ts` doesn't stub the service, so it
  throws at construction. A variant: the test *does* stub it but registers the
  stub AFTER `createInstance(...)` of the class -- order matters, stub first.
  Recurring casualties: `chatAgents.test.ts`, `defaultAccount.test.ts`,
  `extensionGalleryService.test.ts`.
- **Positron flips an upstream default.** A test assumes an upstream config
  default, but Positron changed it (e.g. `telemetry.telemetryLevel` defaults to
  `off`, not `all`), so the test's expected value no longer holds. Fix the test
  setup to establish the value it needs explicitly rather than leaning on the
  default.
- **PWB behavioral patch invalidates a negative assertion.** PWB patches
  `isProposedApiEnabled` to always return true, so any upstream test asserting
  that a proposed-API check *throws* (`checkProposedApiEnabled`) can never pass.
  Skip such a test with a `// --- Start Positron ---` note explaining the patch.
- **Positron edited the production class, not the test.** Positron modified an
  upstream class (new fields it reads, new gates it checks -- e.g. reading
  `positronVersion` or gating on `update.positron.channel`) but the upstream
  test still exercises the pre-Positron behavior. Update the test to set up the
  Positron inputs the production code now reads.

#### Extension host tests

The `test / ext-host` CI job runs three driver scripts in sequence, matching
`.github/workflows/test-ext-host.yml`: `scripts/test-integration-pr.sh` (Positron
extensions, Electron), `scripts/test-remote-integration.sh` (upstream API/language
suites, Remote), and `scripts/test-web-integration.sh` (Chromium). A red job can
come from any of the three, not just the first.

Read this job's failure carefully: it has a signature that looks green. Every
suite can report `N passing` and `Extension host test runner exit code: 0` while
the job still ends in `##[error]Process completed with exit code 1`. When that
happens the failure is in the driver script, not a test:

- **`set -e` cleanup race.** The drivers `rm -rf` a throwaway user-data temp dir
  at the end. A builtin extension (notably `ms-python`) can still be writing a
  bytecache into it during teardown, so `rm` fails with `rm: cannot remove ...
  Directory not empty` and `set -e` turns that into exit 1. That one `rm:` line
  sits just above the exit code, after the last suite's `exited with code: 0`.
  These temp-dir cleanups must be best-effort (`|| true`); don't chase it as a
  test failure.
- **Unhandled rejection at shutdown.** A rejected promise logged as `rejected
  promise not handled within 1 second` can fail the process after tests pass.
  Note it appears benignly in many suites (e.g. copilot's `GitHubLoginFailed`);
  only treat it as the cause if it correlates with the failing process.

So when the ext-host job is red, don't stop at the mocha summary. Scan the tail of
the failing suite for a non-test line (`rm:`, a stack trace, a crash) between the
last `exited with code: 0` and the final exit code.

Next, install all e2e test dependencies and run the test suite. Investigate any
failures and fix them if they are caused by the merge.

### Step 6: Check the test tag map

The `pr-tags` CI job fails if the merge touches a Positron-owned source dir that
has no entry in `.github/workflows/test-tag-paths-map.json`. A merge often pulls
Positron edits into upstream dirs that aren't mapped yet (e.g. a change under
`src/vs/platform/policy/`), so check this before pushing. Reproduce the exact CI
check locally:

```bash
source scripts/lib/pr-tags-lib.sh
find_unmapped_positron_dirs "$(git diff --name-only origin/main...HEAD)" \
  .github/workflows/test-tag-paths-map.json
```

On a large merge this takes a minute or two (it reads each changed file's
copyright header). Add every dir it prints to the map: a feature tag list like
`["@:console"]` if that dir has e2e coverage, or `[]` if it doesn't. For an
upstream dir where only a Posit-owned file or two live, map the dir to `[]` and,
if a Posit-owned file has coverage, add a longer per-file key for it.

Note this local check is stricter than CI: the `pr-tags` job only sees the first
3000 changed files (GitHub's API cap), so on a big merge it can miss dirs this
command catches. Map them anyway.

### Step 7: Document

Summarize all your findings and any design decisions you made during the merge
at the end of the log file. Include any manual steps engineers will need to take
when pulling down the merged code.

## Step 8: Final Tests

Prompt the user to commit the change (a prerequisite to running the CI lab
tests). Tell them you're done with the merge and preliminary tests are passing,
and you need a commit to run the next phase.

After verifying that the user has commited the changes, run all the tests in the
Docker CI lab environment. Again, investigate failures and fix them. Think about
whether each failure is a real product bug or needs test code/expectations
updated.

Note all test failures and their resolution in the log file, especially if the
test needed to be updated to match new or changed behavior.

## References

See these references for more information:
- `change-markers.md`: how to interpret, create and use change markers (Start Positron, Start PWB)
- `package-json.md`: how to handle conflicts in package.json and package-lock.json files
- `codicons.md`: how to handle conflicts in codicon.ttf and codiconLibrary.ts files
