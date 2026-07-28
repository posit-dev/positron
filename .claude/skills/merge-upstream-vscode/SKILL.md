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

### Step 4: Compile

Once installation is complete, compile the code to check for compile errors:
`npm run compile`.

### Step 5: Test

Run the unit tests and the extension host tests. Investigate and fix any
failures, and keep running until they pass.

Next, install all e2e test dependencies and run the test suite. Investigate any
failures and fix them if they are caused by the merge.

### Step 6: Document

Summarize all your findings and any design decisions you made during the merge
at the end of the log file. Include any manual steps engineers will need to take
when pulling down the merged code.

## Step 7: Final Tests

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
