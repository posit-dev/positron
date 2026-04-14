---
name: qa-agent
description: AI-driven QA agent for Positron -- autonomously drives a live IDE to verify PRs, features, and bug fixes
allowed-tools: ["Bash", "Read", "WebFetch"]
user-invocable: true
---

# QA Agent

> **See also:** For hand-writing permanent e2e tests with Playwright, see the `author-e2e-tests` skill.

Performs on-demand QA testing by driving Positron through test scenarios using the explore runner. Accepts a PR number, branch diff, or natural-language description.

## Rules for This Workflow

- **20-minute time cap.** Record the wall-clock time when you send your first tool call.
  - **At 15 minutes:** Stop all diagnostic/retry work. Send `/done` to the runner,
    report whatever results you have (partial is fine), and proceed to Step 5
    (cleanup and save prompt). Use `TIMED OUT` as the result header if the core
    test never completed.
  - **At 20 minutes absolute hard stop:** If you are still running, immediately
    send `/done`, kill any remaining Positron processes
    (`pkill -f "Positron.*vscsmoke" 2>/dev/null`), and report a summary of what
    was attempted and what is still unknown. Skip `--save` and `--comment` actions.
  - **Diagnostic rabbit holes are the #1 time sink.** If `/run-plan` fails and the
    first retry also fails, you have two choices: (a) report the failure with
    whatever diagnostics you gathered, or (b) switch to explore mode for ONE
    focused investigation. Do NOT enter multi-round diagnostic loops (snapshot,
    try different selectors, re-check DOM, etc.) -- each round costs 2-3 minutes
    and rarely converges.
- **Do NOT use TaskCreate or TaskUpdate.** This workflow is fast and linear -- task tracking adds overhead with zero value.
- **Avoid `$'...'` bash syntax** (ansi_c_string). Use heredocs or plain strings instead. The `$'...'` pattern triggers permission prompts for users and blocks CI. See `references/runner-api.md` for safe alternatives.
- **Notebook kernel timing:** When testing notebooks, always wait for the kernel to connect before running cells. Use `newNotebook` action to create, then separate `addCodeToCell` and run steps. Do NOT use `addCodeToCell({ run: true })` immediately after notebook creation -- the kernel may not be ready.
- **Do NOT invent runner syntax that doesn't exist.** There is no `captureAs`, `$ref.id`, `$pySession`, or variable interpolation in `/run-plan`. POM methods return values in the response JSON -- read the `(Returns: ...)` annotation in the POM reference to see what's available.
- **No regex literals in JSON.** `/pattern/` is not valid JSON. For POM methods that accept `string | RegExp`, use `{"$regex": "pattern"}` (optionally `{"$regex": "pattern", "$flags": "i"}` for flags).
- **Do NOT report hallucinated limitations as rough edges.** If a step fails because you used syntax that doesn't exist, that's your error, not a runner limitation.
- **Every action must have a verification step.** If you perform an action, assert the expected outcome. Clicked "Copy"? Use `clipboard.expectClipboardTextToBe(expected)` to verify contents. Ran code? Check the output. Opened a file? Verify the tab. An action without verification is an incomplete test -- it only proves the action didn't throw, not that it worked. Do NOT improvise clipboard verification (e.g., pasting into a cell) -- always use the `clipboard` POM.
- **Clipboard timing in the runner:** Clipboard writes are timing-sensitive. In `/run-plan`, the copy action and clipboard assertion are separate steps with no retry loop, so `expectClipboardTextToBe` may time out even when the copy worked. **Distinguish two failure modes:**
  - **Timeout with empty/unchanged clipboard:** Likely a timing issue. Note it as a known timing limitation and move on.
  - **Wrong clipboard content** (e.g., got `" "` instead of `"hello world"`): **This is likely a product bug**, not a timing issue. The copy ran and produced the wrong result. Apply the feature-behavior failure triage in Step 3b before working around it.
  The saved `.test.ts` file MUST wrap action + assertion in `expect.toPass()` -- see `shared-e2e-references/pom-patterns.md` for the pattern.

## IMMEDIATE: Launch Runner First

**Before reading any other section**, fire the runner launch in the background. The runner
takes 30-60s to boot and has ZERO dependencies on planning, references, or input parsing.
Every second spent reading docs before launching is wasted wall-clock time.

**In your very first tool-call message**, include these two background commands alongside
whatever reference reads you need:

**Background command 1 -- Launch runner:**
For `--build`:
```bash
rm -rf /tmp/vscsmoke/d-* 2>/dev/null; rm -f /tmp/explore-runner-port && EXPLORE_TITLE="<short description>" BUILD=/Applications/Positron.app npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &
```
For `--local` or default:
```bash
rm -rf /tmp/vscsmoke/d-* 2>/dev/null; rm -f /tmp/explore-runner-port && EXPLORE_TITLE="<short description>" npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-electron 2>&1 &
```
For `--browser <name>`:
```bash
rm -rf /tmp/vscsmoke/d-* 2>/dev/null; rm -f /tmp/explore-runner-port && EXPLORE_TITLE="<short description>" ALLOW_EXPLORE=1 npx playwright test test/e2e/tests/_verify/verify.test.ts --project e2e-<name> 2>&1 &
```

**Background command 2 -- POM ref staleness check:**
```bash
REF=test/e2e/tests/_generated/pom-reference.md && if [ ! -f "$REF" ] || [ -n "$(find test/e2e/pages -name '*.ts' -newer "$REF" 2>/dev/null | head -1)" ]; then npx tsx scripts/generate-pom-reference.ts; else echo "POM ref is fresh"; fi
```

**Foreground command 3 -- PR context (PR mode only):**

Fetch the PR metadata and file list -- these are small, fast calls that return in Message 1.
For each PR number, fire `gh pr view` and `gh pr diff --name-only` in parallel:
```bash
gh pr view <number> --repo posit-dev/positron --json title,body,labels | head -100
gh pr diff <number> --repo posit-dev/positron --name-only
```
For multiple PRs (e.g., `456 789`), fetch all in the same parallel batch:
```bash
gh pr view 456 --repo posit-dev/positron --json title,body,labels | head -100
gh pr diff 456 --repo posit-dev/positron --name-only
gh pr view 789 --repo posit-dev/positron --json title,body,labels | head -100
gh pr diff 789 --repo posit-dev/positron --name-only
```
Merge the file lists and combine descriptions when planning test steps.

If `--context <issue>` flag:
```bash
gh issue view <issue-number> --repo posit-dev/positron --json title,body | head -50
```

**Do NOT fetch the full diff** (`gh pr diff` without `--name-only`) in the default flow.
The PR title, body, and file list are enough to plan a good test. The full diff is
expensive (1000+ lines, slow GH API) and rarely changes the test plan.

For `--branch` mode, use git commands instead:
```bash
git diff main...HEAD --name-only
```


**Then continue with Steps 0-2 while the runner boots in the background.**

## Input Formats

```
/qa-agent 456                            PR diff, prompt for target
/qa-agent 456 --local                    PR diff, local dev
/qa-agent 456 --build --no-save          PR diff, built app, CI-friendly
/qa-agent 456 789                        Multiple PRs (dependent or independent)
/qa-agent 456 --context 12345            PR diff + issue enrichment
/qa-agent --branch --local               Branch diff, local dev
/qa-agent --branch feature/my-branch     Named branch diff
/qa-agent "free text" --build            Description, built app
/qa-agent --save 456                     PR diff, auto-save test file
/qa-agent --comment 456                  PR diff, copy verification comment to clipboard
/qa-agent --save --comment 456           PR diff, save test + copy comment
/qa-agent --browser firefox 456          PR diff, Firefox
/qa-agent 456 --edge-cases --build      PR diff, built app, with input diversity
```

**Target (mutually exclusive):**
- `--local`: Run against local dev instance, skip prompt
- `--build`: Run against `/Applications/Positron.app`, skip prompt
- No flag: Prompt the user to choose

**Save behavior (mutually exclusive):**
- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run

**Comment behavior:**
- `--comment`: Generate a verification comment and copy to clipboard after test completes (no prompt)
- `--no-comment`: Never generate a verification comment, never prompt
- No flag: Prompt the user (option available in post-test menu)

**Other flags:**
- `--branch`: Test current branch's changes vs main. Optionally pass a branch name (e.g., `--branch feature/my-branch`)
- `--edge-cases`: After planning core test steps, add 1-2 input variants per scenario to exercise different code paths (errors, empty values, special formatting, boundary conditions). Targets 10-20 total steps.
- `--context <issue>`: Pull issue body as enrichment for test planning. Does not resolve the issue to a PR -- use this alongside a PR number for richer context
- `--browser <name>`: Firefox, Chromium, or WebKit instead of Electron

**Input types:**
- **PR number(s)** (e.g., `456` or `456 789`): Primary mode. Gets diff and metadata directly via `gh pr diff` and `gh pr view`. Numbers are always treated as PR numbers. If `gh pr view` fails, error immediately -- no fallback to issue search. Multiple PRs: fetch all in parallel, merge file lists, combine descriptions into one test plan.
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

**If PR number (default):**

The PR title, body, and file list were fetched in the IMMEDIATE section (Message 1).
Use these to plan:

1. **Validate the PR exists.** If `gh pr view` failed, error immediately:
   ```
   No PR found for #456. Pass a PR number, or use --branch to test local changes.
   ```
2. **Validate testability** (see below)
3. **Classify the changed files** from `--name-only` output: user-facing, shared component, test, build/CI, docs
4. **Plan 5-10 test steps** from the PR title + body + file classification. The PR description tells you *what* to test. The file list tells you *where* the changes are and which POMs to use. **Cover ALL languages/areas mentioned in the PR title** -- if the PR says "R and Python" or "R and Quarto", test both, not just one.
5. Check file paths for feature flags (see table below)
6. Check PR body for browser hints (see Browser Selection below)

**If PR number with `--context <issue>`:**

Same as above, plus the issue body (also fetched in Message 1) provides the "why"
(bug report, expected behavior) for richer test planning.

**If `--edge-cases` flag is set:**

After planning the core 5-10 steps, do a second pass. For each core test step that
involves user-visible output or data transformation, add 1-2 additional steps that
test the same action with inputs designed to exercise different code paths. Vary the
*kind* of input -- errors vs clean output, empty vs populated, special characters vs
plain text, multi-line vs single-line. Target 10-20 total steps. Do not hardcode
specific edge cases -- reason about what inputs would reveal bugs in this specific
feature.

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
| `inlineQuarto` or `quarto` with inline output | `settings.set({"positron.quarto.inlineOutput.enabled": true})` |

**Prefer creating test files on the fly** over reading files from qa-example-content.
Use the `createFile` action to write a `.qmd`, `.py`, `.R`, or `.csv` with exactly
the content you need, then open and test it. Self-contained tests are faster to plan
(no file reading needed) and don't depend on external test data.

**Shared test references:**

When generating tests or choosing POM methods, consult these shared reference docs:
- `../shared-e2e-references/pom-patterns.md` -- POM method selection, confusable methods, POM-first rules
- `../shared-e2e-references/test-conventions.md` -- only read when saving a .test.ts file (Step 6), not during planning
- `../shared-e2e-references/common-mistakes.md` -- only read when saving a .test.ts file (Step 6), not during planning

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

**Parallel launch (already fired in IMMEDIATE section):**

The runner, POM ref gen, and PR context calls were all fired in your first message.
The PR title/body and file list are already in your context. Now:

1. **Read ALL potentially relevant per-POM files in ONE parallel message.**

   Over-read upfront. Small files are cheap (10-80 lines each). Extra messages
   from discovering you need more POMs later cost 10-20s each. Read every POM
   that could be relevant based on the file list, not just the obvious ones.

   Include `sessions.md` and `settings.md` in every run (always needed for setup).
   Then add POMs based on the changed file paths.

   **Default rule:** file path containing `<name>/` → read `pom-ref/<name>.md`.
   Most POMs are 1:1 (e.g., `console/` → `console`, `terminal/` → `terminal`,
   `help/` → `help`, `plots/` → `plots`, `debug/` → `debug`).

   **Exceptions (multi-POM or non-obvious mappings):**

   | File list contains | Also read these POMs |
   |-------------------|---------------------|
   | `positronNotebook/` or `notebookCells/` | `notebooksPositron`, `editors`, `editor` |
   | `inlineDataExplorer` or `dataGrid` | `inlineDataExplorer`, `dataExplorer` |
   | `inlineQuarto` or `quarto` | `inlineQuarto`, `quickaccess` |
   | `console/` | `console`, `variables` |
   | `dataExplorer/` | `dataExplorer`, `dataExplorer.grid` |
   | `variables/` | `variables`, `console` |

   **Always include `clipboard.md`** when the PR involves copy, paste, or clipboard
   operations (e.g., "Copy Output Text", "Copy Image", copy-to-clipboard buttons).
   Use `clipboard.expectClipboardTextToBe(expected)` to verify clipboard contents
   after any copy action -- do NOT improvise verification with paste-into-cell workarounds.

   Also include `shared-e2e-references/pom-patterns.md` and `references/runner-api.md`
   in this same parallel message.

   Do NOT read `pom-reference.md` (the 800+ line monolith). Use the per-POM files.
   Do NOT defer POM reads to later messages -- read them all now.

   **HARD GATE: Verify every POM method you plan to use exists in the per-POM files
   you just read.** Confirm exact method names and parameter types. Do NOT guess,
   abbreviate, or infer method names. If you cannot find a method, check for similar
   names. Guessed names (e.g., `openHelpPane` instead of `openHelpPanel`) waste a
   retry and add 10-15s.

2. **Plan test steps** from the PR title, body, and file list per Step 1.

3. **Send description** (skip the poll -- the runner has had 30-40s head start and is almost always ready):
   ```bash
   PORT=$(cat /tmp/explore-runner-port) && curl -s -X POST "http://localhost:${PORT}/describe" \
     -H 'Content-Type: application/json' \
     -d '{"description": "PR 456: Panel hiding behavior when closing editors"}'
   ```
   If the port file doesn't exist yet, the `cat` will fail -- just retry once after 5s.
   Do NOT use a poll loop. The runner is ready by now in 99% of runs.

### Step 3: Execute Test via /run-plan (Primary)

Use `POST /run-plan` to execute the entire test in one HTTP call. A happy-path test run is **4 tool calls total**: launch + poll, read POM reference, POST /run-plan, POST /done.

```bash
PORT=$(cat /tmp/explore-runner-port) && curl -s -X POST "http://localhost:${PORT}/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{"title": "PR 456: Variable appears after execution", "stepTimeout": 5000, "steps": [
    {"type": "pom", "pom": "sessions", "method": "start", "args": ["python"], "timeout": 30000, "title": "Start Python session"},
    {"type": "pom", "pom": "console", "method": "executeCode", "args": ["Python", "x = 42"], "timeout": 15000, "title": "Execute x = 42"},
    {"type": "pom", "pom": "variables", "method": "expectVariableToBe", "args": ["x", "42"], "title": "Verify x in Variables pane"}
  ]}'
```

See `references/runner-api.md` for full API documentation, response formats, scoping, explore mode routes, action tables, and **timeout tiers**.

**Timeout discipline:** Failed steps burn their full timeout doing nothing useful. Use
the shortest timeout that covers the happy path -- see the Timeout Tiers table in
`references/runner-api.md`. Key rules:
- `stepTimeout: 5000` covers assertions and UI checks (the majority of steps -- 5s is plenty)
- Override to `15000-20000` for code execution, cell runs, output waits
- Override to `30000-40000` ONLY for session starts and kernel connections
- **Never set timeout above 20s** for anything other than session/kernel steps

**POM first, raw never (for assertions):** Do NOT use raw selectors, evaluate, or screenshots for verification when a POM method exists. Look for `expect*` and `waitFor*` methods in the POM reference -- these are assertion methods with built-in retries. Raw actions (`snapshot`, `takeScreenshot`) are for **debugging failures**, not for assertions.

### Step 3b: Failure Handling and Retries

If `/run-plan` returns failures, see `references/failure-handling.md` for the full triage workflow: classify infrastructure vs. feature-behavior failures, retry budget (2 max with `resetBefore: true`), and POM Health tracking.

### Step 4: Report Results

Report using the summary format with step-by-step pass/fail results.

See `references/reporting.md` for full report format, POM Recommendations, POM Health, retry summary, and rough edges templates.

**FINAL GATE -- POM Health self-check (do this AFTER writing the retry summary):**
Before moving to Step 5, re-read your retry summary and every step in the test plan.
For EACH of these, answer yes or no:
1. Did any step use `clickRole`, `clickText`, `clickSelector`, `waitForSelector`, or `evaluate`?
2. Did any retry fix switch from a POM method to a raw action (or vice versa)?
3. Could any raw action be replaced by a POM method that exists in the per-POM reference files?

If ANY answer is yes, you MUST add a POM Health section. If you already wrote the
report without it, go back and add it now. Do NOT proceed to Step 5 without completing
this check.

### Step 5: Cleanup and Save Prompt

```bash
PORT=$(cat /tmp/explore-runner-port) && curl -s -X POST "http://localhost:${PORT}/done"
```

**`/done` can be parallelized with screenshots** (e.g., `takeScreenshot` + `/done` in one message).
But do NOT parallel `/done` with the file collision `ls` check -- the glob exits non-zero
when no files match, which cancels parallel calls in the same message.

**After reporting results and sending `/done`:**

Execute all flagged actions without prompting:
- **`--save`:** Save the test file (Step 6).
- **`--comment`:** Generate a verification comment and copy to clipboard (see `references/verification-comment.md`).
- **`--save --comment`:** Do both.
- **`--no-save`:** Done. Do NOT save, do NOT prompt.
- **`--no-comment`:** Do NOT generate a verification comment, do NOT prompt.

If `--save`, `--comment`, `--no-save`, or `--no-comment` is set, **do NOT prompt with AskUserQuestion.**
- **No flag (default):** Ask the user what to do next using `AskUserQuestion` with
  `multiSelect: true`:

Ask: "What would you like to do next?" with these options:
- **Save as test file** -- Generate a `.test.ts` file (Step 6)
- **Generate verification comment** -- Create a GitHub-ready verification comment (see `references/verification-comment.md`)
- **Make POM updates** -- Implement the POM recommendations from the report (if any were flagged)

**Do NOT skip this prompt when no flag is set.** This applies even if:
- The test required retries (the corrected steps are what gets saved)
- Some steps failed but the core scenario worked (save the passing steps)
- The result was "PASSED after retry"

Wait for the user's answer, then execute all selected actions.
If "Save as test file" is selected, use the CORRECTED method names and values
from the successful retry (not the original failed attempt).

### Step 6: Save Test

See `references/save-test.md` for file path conventions, format rules, and fixture usage.
Read it when saving -- not during planning.

## Verification Comment

See `references/verification-comment.md` for the GitHub markdown template, rules, and clipboard copy command.

## Error Handling

- **Runner not starting**: Ensure build daemons are running (`npm run build-start`).
- **Action fails**: Read the enriched state first. Use `snapshot` in explore mode to see the UI if state is insufficient.
- **Unknown POM or method**: The response lists available options. Cross-check with the per-POM reference files.
- **Runner timeout**: Auto-stops after 15 minutes. Send `/health` to keep alive.

## Artifacts

Playwright trace is captured automatically. Use `takeScreenshot` or `snapshot` for on-demand evidence.
