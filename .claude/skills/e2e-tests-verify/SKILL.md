---
name: e2e-verify
description: AI-driven on-demand QA testing for Positron -- drives the IDE via POM reflection, custom actions, and raw Playwright
allowed-tools: ["Bash", "Read", "WebFetch"]
user-invocable: true
---

# QA Test

> **See also:** For hand-writing permanent e2e tests with Playwright, see the `e2e-author` skill.

Performs on-demand QA testing by driving Positron through test scenarios using the explore runner. Accepts a PR number, branch diff, or natural-language description.

## IMMEDIATE: Launch Runner First

**Before reading any other section**, fire the runner launch in the background. The runner
takes 30-60s to boot and has ZERO dependencies on planning, references, or input parsing.
Every second spent reading docs before launching is wasted wall-clock time.

**In your very first tool-call message**, include these background commands alongside
whatever reference reads you need:

```
Bash (background): rm -f /tmp/explore-runner-port && <launch command per target mode, see references/runner-launch.md>
Bash (background): <POM ref staleness check, see references/runner-launch.md>
```

Determine the launch command from the target flag:
- `--build`: `BUILD=/Applications/Positron.app npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &`
- `--local` or default: `npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &`
- `--browser <name>`: `ALLOW_EXPLORE=1 npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-<name> 2>&1 &`

Set `EXPLORE_TITLE` to a short description (e.g., `EXPLORE_TITLE="PR 456: Variable filter"`).

**Then continue with Steps 0-2 while the runner boots in the background.**

## Input Formats

```
/e2e-verify 456                            PR diff, prompt for target
/e2e-verify 456 --local                    PR diff, local dev
/e2e-verify 456 --build --no-save          PR diff, built app, CI-friendly
/e2e-verify 456 --context 12345 --deep     PR diff + issue enrichment, exhaustive
/e2e-verify --branch --local               Branch diff, local dev
/e2e-verify --branch feature/my-branch     Named branch diff
/e2e-verify "free text" --build            Description, built app
/e2e-verify --save 456                     PR diff, auto-save test file
/e2e-verify --browser firefox 456          PR diff, Firefox
```

**Target (mutually exclusive):**
- `--local`: Run against local dev instance, skip prompt
- `--build`: Run against `/Applications/Positron.app`, skip prompt
- No flag: Prompt the user to choose

**Save behavior (mutually exclusive):**
- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run

**Other flags:**
- `--branch`: Test current branch's changes vs main. Optionally pass a branch name (e.g., `--branch feature/my-branch`)
- `--deep`: Exhaustive mode -- gathers all signals and generates a thorough test plan (10-15+ steps with edge cases). Without this flag, tests are diff-driven and targeted (5-10 steps)
- `--context <issue>`: Pull issue body as enrichment for test planning. Does not resolve the issue to a PR -- use this alongside a PR number for richer context
- `--browser <name>`: Firefox, Chromium, or WebKit instead of Electron

**Input types:**
- **PR number** (e.g., `456`): Primary mode. Gets diff and metadata directly via `gh pr diff` and `gh pr view`. Numbers are always treated as PR numbers. If `gh pr view` fails, error immediately -- no fallback to issue search.
- **Branch diff** (`--branch`): Uses `git diff main...HEAD` (or named branch vs main)
- **Free-text description** (quoted string): No diff, no GH calls. AI plans from description alone.

## Workflow

### Step 0: Choose Target

**If `--build` flag is present:** Skip the prompt and use build mode.
**If `--local` flag is present:** Skip the prompt and use local dev mode.

If neither `--build` nor `--local` is present, **ask the user** which target to run against using `AskUserQuestion`:
- **Local dev instance (Recommended)** -- runs against the local development build (default, no extra setup)
- **Built app** -- runs against an installed Positron build (e.g. `/Applications/Positron.app` on macOS)

**When running in build mode:**

1. Set `BUILD=/Applications/Positron.app` (macOS) in the Playwright launch command in Step 2.

2. Log the version of the built app before starting:
```bash
.claude/skills/e2e-tests-plan/scripts/detect_versions.sh
```
Report to the user: `Target: Built app -- Positron 2026.02.0 (build 10), macOS 26.2`

**When running in local dev mode:**
Report to the user: `Target: Local dev instance`

### Step 1: Parse Input and Plan Test Steps

**If free-text description:**
Parse into 5-10 concrete, ordered test steps. Each step becomes one entry in the `/run-plan` steps array. Skip to Step 2 (no GH calls needed).

**If PR number (default -- diff-driven):**

PR context and diff are fetched in Step 2 as part of the parallel launch. After those results land:

1. **Validate the PR exists.** If `gh pr view` failed, error immediately:
   ```
   No PR found for #456. Pass a PR number, or use --branch to test local changes.
   ```
2. **Validate testability** (see below)
3. Analyze the diff and show transparent reasoning (see diff analysis workflow in `references/diff-analysis.md`)
4. Generate 5-10 test steps from the diff analysis

**If PR number with `--context <issue>`:**

Same as above, but the issue body (fetched in parallel during Step 2) is used as
enrichment for test planning. The issue provides the "why" (bug report, expected
behavior) while the PR diff provides the "what" (code changes to exercise).

**If PR number with `--deep`:**
1. Fetch ALL context: PR diff, PR body, PR comments, plus issue body if `--context` provided
2. **Validate testability** (see below)
3. Show transparent analysis with all signals labeled
4. Generate an exhaustive test plan: 10-15+ steps with edge cases, blast radius
   smoke tests, and regression checks

**If `--branch` flag:**

The diff comes from git, not GitHub:
- **No argument** (`--branch`): `git diff main...HEAD` on current branch
- **Branch name** (`--branch feature/my-branch`): `git diff main...<branch>`

For the full diff analysis workflow, see `references/diff-analysis.md`.

**Feature flag detection (always do this):**

After identifying the changed files, check if any require feature flags to be enabled.
These are path-based rules -- if the PR touches files under these paths, add the
corresponding setup step to the test plan:

| Changed file path contains | Required setup |
|---------------------------|----------------|
| `positronNotebook/browser/` | `enablePositronNotebooks({"$pom": "settings"})` |
| `positron.environments` or `positronVariables` | `settings.set({"positron.environments.enable": true}, {"reload": true})` |

Also check existing tests in the same area (see `references/diff-analysis.md` --
"Check existing tests for setup patterns") for any other setup requirements.

**Shared test references:**

When generating tests or choosing POM methods, consult these shared reference docs:
- `../shared-e2e-references/test-conventions.md` -- imports, suiteId, commenting style, test.step() rules
- `../shared-e2e-references/pom-patterns.md` -- POM method selection, confusable methods, POM-first rules
- `../shared-e2e-references/common-mistakes.md` -- 32 gotchas to avoid

**CRITICAL:** Follow all POM method selection rules in `../shared-e2e-references/pom-patterns.md`.

#### Testability Check

Before starting the runner, confirm the PR's changes can actually be tested with this framework.

**Definitely untestable -- stop and tell the user:**

- **Requires a different OS**: WSL, Windows-only, Linux-only issues cannot be tested on macOS
- **Requires remote connections**: SSH, WSL, Docker remote host, Codespaces
- **Requires specific hardware**: GPU, multiple monitors, specific screen sizes beyond `resizeWindow`
- **Is a packaging/deployment issue**: CDN URLs, installers, update mechanisms, server downloads
- **Is purely about build/CI**: GitHub Actions, CI pipelines, build scripts

**Might work locally -- ask the user before blocking:**

- **Requires AI features** (ghost cells, assistant, copilot): built apps typically have AI providers pre-configured. If not already using `--build` mode, suggest it: "This issue involves AI features. Use `--build` to test against the installed app which has AI providers configured."
- **Requires external services**: databases, cloud APIs -- ask if the user has access locally before assuming they don't.
- **Requires specific data**: large files, proprietary datasets -- ask if the data exists in the workspace.

If the changes are untestable, respond with:
```
Cannot test PR#NNNNN with the explore runner:
- Reason: [why it can't be tested]
- The PR is about: [brief summary]
- What would be needed: [what environment/setup would be required]
```

If the PR is **partially testable** (e.g., a UI bug that also has a server component), explain what CAN be tested and proceed with those parts.

#### Browser Selection

Decide which browser/project to run the test in. The default is `e2e-electron` (desktop Electron app).

**If `--browser` flag is provided**, use that browser directly:
- `--browser firefox` -> `e2e-firefox`
- `--browser chromium` -> `e2e-chromium`
- `--browser webkit` -> `e2e-webkit`

**If no flag but PR body mentions a specific browser**, infer automatically:
- PR mentions "Firefox", "firefox-specific", "Firefox on Workbench" -> use `e2e-firefox`
- PR mentions "Safari", "WebKit" -> use `e2e-webkit`
- PR mentions "Chrome", "Chromium" (but not Electron) -> use `e2e-chromium`
- PR mentions "Workbench", "Positron Pro", "browser mode" (no specific browser) -> use `e2e-chromium`
- No browser mentioned, or mentions "Electron", "desktop" -> use `e2e-electron` (default)

Tell the user which browser was selected and why:
```
Browser: Firefox (inferred from PR mentioning "Firefox on Workbench")
```

**Important browser mode differences:**
- `resizeWindow` and `getWindowSize` only work in Electron mode (they use Electron's BrowserWindow API)
- Browser mode auto-starts a code-server; no manual server setup needed
- All POM actions and raw Playwright actions work the same in both modes
- The `--grep ""` flag is needed to override the project's default tag filter

### Step 2: Start the Explore Runner (Parallel Launch)

**All independent IO fires in a single message.** The runner startup (30-60s) is the
longest leg -- GH calls and POM ref gen finish within that window.

See `references/runner-launch.md` for launch commands per mode (local dev, built app, browser).

**Parallel launch message (all tool calls in one message):**

For PR number input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command from runner-launch.md> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed, from runner-launch.md>
Bash: gh pr diff <number> --repo posit-dev/positron | head -2000
Bash: gh pr view <number> --repo posit-dev/positron --json title,body,labels
Bash: gh issue view <context-number> --repo posit-dev/positron --json title,body  (only if --context flag)
```

For `--branch` input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed>
Bash: git diff main...<branch> | head -2000
Bash: git diff main...<branch> --name-only
```

For free-text input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed>
```

**After parallel results land:**

1. Read the POM reference (should be generated by now):
   ```
   Read test/e2e/tests/_generated/pom-reference.md
   ```

2. **Plan test steps** using the diff/PR context from the parallel calls (this is Step 1's analysis, which runs after the data arrives).

3. **Poll for runner readiness** (the runner has had 20-40s of head start by now -- likely already ready):
   ```bash
   for i in $(seq 1 60); do
     if [ -f /tmp/explore-runner-port ]; then
       PORT=$(cat /tmp/explore-runner-port)
       HEALTH=$(curl -s "http://localhost:$PORT/health" 2>/dev/null)
       if echo "$HEALTH" | grep -q ok; then
         echo "Runner ready on port $PORT"
         break
       fi
     fi
     sleep 1
   done
   ```

4. **Send description** so the report shows what is being tested:
   ```bash
   PORT=$(cat /tmp/explore-runner-port)
   jq -n --arg desc $'Verify PR #456: Panel hiding behavior when closing editors:\n- Panel maximizes when visible and last editor closes\n- Panel stays hidden when user hid it (Cmd+J)' \
     '{description: $desc}' \
   | curl -s -X POST "http://localhost:$PORT/describe" -H 'Content-Type: application/json' -d @-
   ```

**Happy-path tool call count:** 5-6 calls total (parallel launch message, read POM ref, poll, POST /describe, POST /run-plan, POST /done).

### Step 2b: Verify POM Methods Before Building Plan (HARD GATE)

**Before building the `/run-plan` payload, verify every POM method you plan to use.**

For each POM in your test plan:
1. Search the POM reference for that POM name (e.g., grep for `## help` or `## plots`)
2. Confirm the exact method name exists and note its parameter types
3. **Do NOT include any method you did not find in the reference**

If you cannot find a method, check for similar names -- the reference lists all available
methods when a POM is found. Do not guess, abbreviate, or infer method names from
the POM name or from other POMs.

This gate exists because guessed method names (e.g., `openHelpPane` instead of
`openHelpPanel`) waste a retry and add 10-15s of dead time.

### Step 3: Execute Test via /run-plan (Primary)

Use `POST /run-plan` to execute the entire test in one HTTP call. A happy-path test run is **4 tool calls total**: launch + poll, read POM reference, POST /run-plan, POST /done.

```bash
PORT=$(cat /tmp/explore-runner-port)
curl -s -X POST "http://localhost:$PORT/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "PR 456: Variable appears after execution",
    "stepTimeout": 10000,
    "steps": [
      {"type": "pom", "pom": "sessions", "method": "start", "args": ["python"], "timeout": 20000, "title": "Start Python session"},
      {"type": "pom", "pom": "console", "method": "executeCode", "args": ["Python", "x = 42"], "title": "Execute x = 42"},
      {"type": "pom", "pom": "variables", "method": "expectVariableToBe", "args": ["x", "42"], "timeout": 5000, "title": "Verify x in Variables pane"}
    ]
  }'
```

See `references/runner-api.md` for full API documentation, response formats, jq tips, scoping, explore mode routes, and action tables.

**POM first, raw never (for assertions):** Do NOT use raw selectors, evaluate, or screenshots for verification when a POM method exists. Look for `expect*` and `waitFor*` methods in the POM reference -- these are assertion methods with built-in retries. Raw actions (`snapshot`, `takeScreenshot`) are for **debugging failures**, not for assertions.

### Step 3b: Failure Handling and Retries

If `/run-plan` returns failures:

1. **Read the error and enriched state.** The `state` fields (`variableNames`, `activeSession`, `notifications`, `openTabs`, `focusedPanel`) often reveal the root cause without needing a snapshot.

2. **Retry budget: 2 attempts max.** On first failure, analyze the error and correct the plan:
   - Wrong method name or args? Fix from the POM reference.
   - Timeout too short? Increase the per-step `timeout`.
   - Session not ready? Add a wait step or increase session start timeout.

3. **Retry with `resetBefore: true`** to clean up state before re-running:
```bash
curl -s -X POST "http://localhost:$PORT/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "PR 456 (retry)",
    "resetBefore": true,
    "stepTimeout": 10000,
    "steps": [...]
  }'
```

The `resetBefore` flag closes editors, clears console, and restores default layout before running.

4. **If both attempts fail**: switch to Explore Mode (see `references/runner-api.md` -- Explore Mode section) for interactive diagnosis, or report the failure.

5. **Track divergences for POM Health reporting.** When a retry succeeds with a different
   POM method or a raw Playwright fallback, note the original method, the replacement,
   and whether either had JSDoc in the reference. Report this in Step 4 under POM Health.

### Step 4: Report Results

Report using the summary format with step-by-step pass/fail results.

See `references/reporting.md` for full report format, POM Recommendations, POM Health, retry summary, and rough edges templates.

**FINAL GATE -- POM Health self-check (do this AFTER writing the retry summary):**
Before moving to Step 5, re-read your retry summary and every step in the test plan.
For EACH of these, answer yes or no:
1. Did any step use `clickRole`, `clickText`, `clickSelector`, `waitForSelector`, or `evaluate`?
2. Did any retry fix switch from a POM method to a raw action (or vice versa)?
3. Could any raw action be replaced by a POM method that exists in pom-reference.md?

If ANY answer is yes, you MUST add a POM Health section. If you already wrote the
report without it, go back and add it now. Do NOT proceed to Step 5 without completing
this check.

### Step 5: Cleanup and Save Prompt

```bash
curl -s -X POST "http://localhost:$PORT/done"
```

**After reporting results and sending `/done`:**
- `--save`: Save the test file immediately (go to Step 6, no prompt needed)
- `--no-save`: Do not save, do not prompt. Done.
- **No flag (default): Ask the user what to do next using `AskUserQuestion` with
  `multiSelect: true`:**

Ask: "What would you like to do next?" with these options:
- **Save as test file** -- Generate a `.test.ts` file (Step 6)
- **Generate verification comment** -- Create a GitHub-ready verification comment (see `references/verification-comment.md`)
- **Make POM updates** -- Implement the POM recommendations from the report (if any were flagged)

**Do NOT skip this prompt.** This applies even if:
- The test required retries (the corrected steps are what gets saved)
- Some steps failed but the core scenario worked (save the passing steps)
- The result was "PASSED after retry"

Wait for the user's answer, then execute all selected actions.
If "Save as test file" is selected, use the CORRECTED method names and values
from the successful retry (not the original failed attempt).

### Step 6: Save Test

Write a standalone `.test.ts` file when saving (via `--save` flag, or user said yes to prompt).

**File path:** `test/e2e/tests/_generated/MMDD_<pr>-<slug>.test.ts`
- `MMDD` is the current date (e.g., `0405`)
- `<pr>` is the PR number if available, omit if free-text or `--branch`
- `<slug>` is a short kebab-case summary (e.g., `variable-filter`)
- **If the file already exists**, append `-1`, `-2`, etc. to the date:
  `0406_12025-ghost-cell-info.test.ts` -> `0406-1_12025-ghost-cell-info.test.ts`
  Check with: `ls test/e2e/tests/_generated/MMDD*<pr>-<slug>* 2>/dev/null`
- Examples:
  - `test/e2e/tests/_generated/0405_456-notebook-outline.test.ts`
  - `test/e2e/tests/_generated/0405-1_456-notebook-outline.test.ts` (second run same day)
  - `test/e2e/tests/_generated/0404_console-sessions.test.ts` (free-text, no PR)

**Format:**
```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from './_qa.setup';

test.use({ suiteId: __filename });

test.describe('Verify PR#456: Variables appear after execution', () => {

	test('Variable x is set after running code', async function ({ app, python }) {
		const { console, variables } = app.workbench;

		// Execute code and verify variable
		await console.executeCode('Python', 'x = 42');
		await variables.expectVariableToBe('x', '42');
	});

});
```

Use `test.describe('Verify PR#<number>: <short summary>')` as the parent block.
Individual test names describe the specific scenario without repeating the PR number.
For free-text tests (no PR number), use `test.describe('Verify: <description>')`.


**Rules:**
- Follow all conventions in `../shared-e2e-references/test-conventions.md`
- Import from `./_qa.setup`, not `../_test.setup`
- Always include `test.use({ suiteId: __filename })` for app isolation
- Map action steps to the equivalent Playwright calls
- File path: `test/e2e/tests/_generated/MMDD_<pr>-<slug>.test.ts`
- **Always use fixtures over workbench properties when available.** Fixtures come
  from the test function parameter, NOT from `app.workbench`. Key fixtures:
  `python`, `r`, `sessions`, `settings`, `hotKeys`, `page`. If you need `settings`,
  add it to the function signature -- do NOT destructure it from `app.workbench`:
  ```typescript
  // CORRECT: settings from fixture parameter
  test('example', async function ({ app, settings }) {
  	await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
  });

  // WRONG: app.workbench.settings is a different object
  test('example', async function ({ app }) {
  	const { settings } = app.workbench; // WRONG TYPE
  });
  ```
- **Use `sessions.start()` to capture session metadata** when the test needs session
  names, IDs, or needs to switch/verify specific sessions. The returned metadata has
  `.id` and `.name` -- use these instead of hardcoding version strings:
  ```typescript
  // CORRECT: capture metadata, use .name for assertions
  const [pySession] = await sessions.start(['python']);
  await sessions.expectSessionPickerToBe(pySession.name);

  // WRONG: hardcoded version string (environment-specific, breaks on other machines)
  await sessions.expectSessionPickerToBe('Python 3.10.15 (Pyenv)');
  ```
  For multiple sessions:
  ```typescript
  const [pySession, rSession] = await sessions.start(['python', 'r']);
  await sessions.select(pySession.id);
  await variables.expectRuntimeToBe('visible', pySession.name);
  ```
- **Do NOT wrap POM calls in `test.step()`.** POM methods already have internal
  `test.step()` wrappers. Use comments to group steps, not `test.step()`:
  ```typescript
  // WRONG
  await test.step('Verify variable', async () => {
  	await variables.expectVariableToBe('x', '42');
  });

  // CORRECT
  // Verify variable appears
  await variables.expectVariableToBe('x', '42');
  ```
- **Do NOT rename `console` when destructuring.** Use `const { console } = app.workbench`
  directly -- do not alias it as `consoleView`, `consolePom`, etc. The existing codebase
  uses `console` everywhere and shadowing the global `console` is fine in test files.

## Verification Comment

See `references/verification-comment.md` for the GitHub markdown template, rules, and clipboard copy command.

## Error Handling

- **Runner not starting**: Ensure build daemons are running (`npm run build-start`).
- **Action fails**: Read the enriched state first. Use `snapshot` in explore mode to see the UI if state is insufficient.
- **Unknown POM or method**: The response lists available options. Cross-check with pom-reference.md.
- **Runner timeout**: Auto-stops after 10 minutes. Send `/health` to keep alive.

## Artifacts

Playwright trace is captured automatically. Use `takeScreenshot` or `snapshot` for on-demand evidence.
