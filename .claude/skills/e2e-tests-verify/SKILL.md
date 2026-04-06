---
name: e2e-verify
description: AI-driven on-demand QA testing for Positron -- drives the IDE via POM reflection, custom actions, and raw Playwright
allowed-tools: ["Bash", "Read", "WebFetch"]
user-invocable: true
---

# QA Test

> **See also:** For hand-writing permanent e2e tests with Playwright, see the `e2e-author` skill.

Performs on-demand QA testing by driving Positron through test scenarios using the explore runner. Accepts a natural-language description or a GitHub issue number.

## Input Formats

```
/e2e-verify "Verify that the Variables pane updates after running x = 42 in the Python console"
/e2e-verify #12345
/e2e-verify #12345 --deep
/e2e-verify --build #12345
/e2e-verify --browser firefox #11593
/e2e-verify --build "Verify plots render correctly"
/e2e-verify --save #12345
/e2e-verify --no-save --build "Quick smoke test"
/e2e-verify --branch
/e2e-verify --branch --build
/e2e-verify --branch feature/my-branch
/e2e-verify --branch --build #9638
/e2e-verify --branch --deep
```

- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run
- `--branch`: Test current branch's changes vs main. Optionally pass a branch name or issue number (see Step 1)
- `--deep`: Exhaustive mode -- gathers all signals (PR comments, linked issues, linked PRs) and generates a thorough test plan (10-15+ steps with edge cases). Without this flag, tests are diff-driven and targeted (5-10 steps)

## Workflow

### Step 0: Choose Target

If `--build` flag is present, skip the prompt and use build mode.

Otherwise, **ask the user** which target to run against using `AskUserQuestion`:
- **Local dev instance (Recommended)** -- runs against the local development build (default, no extra setup)
- **Built app** -- runs against an installed Positron build (e.g. `/Applications/Positron.app` on macOS)

**When running in build mode:**

1. Set `BUILD=/Applications/Positron.app` (macOS) in the Playwright launch command in Step 2.

2. Log the version of the built app before starting:
```bash
.claude/skills/e2e-verify-plan/scripts/detect_versions.sh
```
Report to the user: `Target: Built app -- Positron 2026.02.0 (build 10), macOS 26.2`

If `--branch` flag is present, this is a **diff-driven** test. The diff is the primary
signal; issue/PR context is enrichment only. `--branch` accepts an optional argument
that determines where the diff comes from:

- **No argument** (`--branch`): Diff current branch vs main
- **Branch name** (`--branch feature/my-branch`): Diff that branch vs main
- **Issue number** (`--branch #9638`): Find the PR that closed this issue, extract its
  diff. Also fetches the issue body as enrichment context. Works for merged PRs too.

To resolve an issue number to a diff:
```bash
gh pr list --search "9638" --state all --repo posit-dev/positron --json number,title,headRefName --limit 5
gh pr diff <pr-number> --repo posit-dev/positron
gh issue view 9638 --repo posit-dev/positron --json title,body,labels
```

The `--branch` flag composes with all other flags:
- `--branch --build`: Analyze current branch diff, run tests against built app
- `--branch --build #9638`: Get diff from issue's PR, run against built app
- `--branch --save`: Analyze diff, auto-save test file
- `--branch --browser firefox`: Analyze diff, run in Firefox
- `--branch feature/my-branch`: Analyze a specific branch

If `--branch` is used without `--build`, ask the user which target to run against
(same as the default flow).

### Step 1: Parse Input and Plan Test Steps

**If free-text description:**
Parse into 5-10 concrete, ordered test steps. Each step becomes one entry in the `/run-plan` steps array.

**If issue number (default -- diff-driven):**
1. Find the PR that closed/addresses this issue:
```bash
gh pr list --search "<number>" --state all --repo posit-dev/positron --json number,title,headRefName --limit 5
```
2. Get the PR diff (primary signal):
```bash
gh pr diff <pr-number> --repo posit-dev/positron | head -2000
```
3. Fetch the issue body for enrichment:
```bash
gh issue view <number> --repo posit-dev/positron --json title,body,labels
```
4. **Validate testability** (see below)
5. Analyze the diff and show transparent reasoning (see diff analysis workflow below)
6. Generate 5-10 test steps from the diff analysis

If no linked PR is found, fall back to generating a test plan from the issue
description alone.

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

**If issue number with `--deep`:**
1. Run the `e2e-verify-plan` skill to generate a full verification guide
2. Fetch ALL context: issue body, PR diff, PR comments, linked issues, linked PRs
3. **Validate testability** (see below)
4. Show transparent analysis with all signals labeled
5. Generate an exhaustive test plan: 10-15+ steps with edge cases, blast radius
   smoke tests, and regression checks

**If --branch flag:**

For the full diff analysis workflow, see `references/diff-analysis.md`.

**Shared test references:**

When generating tests or choosing POM methods, consult these shared reference docs:
- `../shared-e2e-references/test-conventions.md` -- imports, suiteId, commenting style, test.step() rules
- `../shared-e2e-references/pom-patterns.md` -- POM method selection, confusable methods, POM-first rules
- `../shared-e2e-references/common-mistakes.md` -- 32 gotchas to avoid

**CRITICAL:** Follow all POM method selection rules in `../shared-e2e-references/pom-patterns.md`.

#### Testability Check

Before starting the runner, confirm the issue can actually be tested with this framework.

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

If the issue is untestable, respond with:
```
Cannot test #NNNNN with the explore runner:
- Reason: [why it can't be tested]
- The issue is about: [brief summary]
- What would be needed: [what environment/setup would be required]
```

If the issue is **partially testable** (e.g., a UI bug that also has a server component), explain what CAN be tested and proceed with those parts.

#### Browser Selection

Decide which browser/project to run the test in. The default is `e2e-electron` (desktop Electron app).

**If `--browser` flag is provided**, use that browser directly:
- `--browser firefox` -> `e2e-firefox`
- `--browser chromium` -> `e2e-chromium`
- `--browser webkit` -> `e2e-webkit`

**If no flag but issue mentions a specific browser**, infer automatically:
- Issue mentions "Firefox", "firefox-specific", "Firefox on Workbench" -> use `e2e-firefox`
- Issue mentions "Safari", "WebKit" -> use `e2e-webkit`
- Issue mentions "Chrome", "Chromium" (but not Electron) -> use `e2e-chromium`
- Issue mentions "Workbench", "Positron Pro", "browser mode" (no specific browser) -> use `e2e-chromium`
- No browser mentioned, or mentions "Electron", "desktop" -> use `e2e-electron` (default)

Tell the user which browser was selected and why:
```
Browser: Firefox (inferred from issue mentioning "Firefox on Workbench")
```

**Important browser mode differences:**
- `resizeWindow` and `getWindowSize` only work in Electron mode (they use Electron's BrowserWindow API)
- Browser mode auto-starts a code-server; no manual server setup needed
- All POM actions and raw Playwright actions work the same in both modes
- The `--grep ""` flag is needed to override the project's default tag filter

### Step 2: Start the Explore Runner

See `references/runner-launch.md` for launch commands per mode (local dev, built app, browser) and POM reference staleness check.

Poll for readiness, then send a description so the report shows what is being tested:
```bash
PORT=$(cat /tmp/explore-runner-port)
jq -n --arg desc $'Verify panel hiding behavior when closing editors:\n- Panel maximizes when visible and last editor closes\n- Panel stays hidden when user hid it (Cmd+J)' \
  '{description: $desc}' \
| curl -s -X POST "http://localhost:$PORT/describe" -H 'Content-Type: application/json' -d @-
```

### Step 3: Execute Test via /run-plan (Primary)

Use `POST /run-plan` to execute the entire test in one HTTP call. A happy-path test run is **4 tool calls total**: launch + poll, read POM reference, POST /run-plan, POST /done.

```bash
PORT=$(cat /tmp/explore-runner-port)
curl -s -X POST "http://localhost:$PORT/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "QA #12345: Variable appears after execution",
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
    "title": "QA #12345 (retry)",
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

**File path:** `test/e2e/tests/_generated/MMDD_<issue>-<slug>.test.ts`
- `MMDD` is the current date (e.g., `0405`)
- `<issue>` is the issue number if available, omit if free-text or `--branch` without issue
- `<slug>` is a short kebab-case summary (e.g., `variable-filter`)
- Examples:
  - `test/e2e/tests/_generated/0405_9638-notebook-outline.test.ts`
  - `test/e2e/tests/_generated/0404_console-sessions.test.ts`
  - `test/e2e/tests/_generated/0405_data-explorer-summary.test.ts`

**Format:**
```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from './_qa.setup';

test.use({ suiteId: __filename });

test.describe('Verify #12345: Variables appear after execution', () => {

	test('Variable x is set after running code', async function ({ app, python }) {
		const { console, variables } = app.workbench;

		// Execute code and verify variable
		await console.executeCode('Python', 'x = 42');
		await variables.expectVariableToBe('x', '42');
	});

});
```

Use `test.describe('Verify #<issue>: <short summary>')` as the parent block.
Individual test names describe the specific scenario without repeating the issue number.
For free-text tests (no issue number), use `test.describe('Verify: <description>')`.


**Rules:**
- Follow all conventions in `../shared-e2e-references/test-conventions.md`
- Import from `./_qa.setup`, not `../_test.setup`
- Always include `test.use({ suiteId: __filename })` for app isolation
- Map action steps to the equivalent Playwright calls
- File path: `test/e2e/tests/_generated/MMDD_<issue>-<slug>.test.ts`
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

## Verification Comment

See `references/verification-comment.md` for the GitHub markdown template, rules, and clipboard copy command.

## Error Handling

- **Runner not starting**: Ensure build daemons are running (`npm run build-start`).
- **Action fails**: Read the enriched state first. Use `snapshot` in explore mode to see the UI if state is insufficient.
- **Unknown POM or method**: The response lists available options. Cross-check with pom-reference.md.
- **Runner timeout**: Auto-stops after 10 minutes. Send `/health` to keep alive.

## Artifacts

Playwright trace is captured automatically. Use `takeScreenshot` or `snapshot` for on-demand evidence.
