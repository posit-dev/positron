---
name: qa-test
description: AI-driven on-demand QA testing for Positron -- drives the IDE via POM reflection, custom actions, and raw Playwright
allowed-tools: ["Bash", "Read", "WebFetch"]
user-invocable: true
---

# QA Test

Performs on-demand QA testing by driving Positron through test scenarios using the explore runner. Accepts a natural-language description or a GitHub issue number.

## Input Formats

```
/qa-test "Verify that the Variables pane updates after running x = 42 in the Python console"
/qa-test #12345
/qa-test --quick #12345
/qa-test --browser firefox #11593
/qa-test --build "Verify plots render correctly"
/qa-test --save #12345
/qa-test --no-save --build "Quick smoke test"
/qa-test --branch
/qa-test --branch --build
/qa-test --branch feature/my-branch
/qa-test --branch --build #9638
/qa-test --branch --save
```

- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run
- `--branch`: Generate test plan from branch diff vs main. Optionally pass a branch name or issue number for enrichment context (see Step 1)

## Workflow

### Step 0: Choose Target

If `--build` flag is present, skip the prompt and use build mode.

Otherwise, **ask the user** which target to run against using `AskUserQuestion`:
- **Local dev instance (Recommended)** -- runs against the local development build (default, no extra setup)
- **Built app** -- runs against an installed Positron build (e.g. `/Applications/Positron.app` on macOS)

**When running in build mode:**

1. Set `BUILD=/Applications/Positron.app` (macOS) in the Playwright launch command in Step 2:
```bash
BUILD=/Applications/Positron.app EXPLORE_TITLE="QA #12381: ..." npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-electron 2>&1 &
```

2. Log the version of the built app before starting:
```bash
.claude/skills/qa-test-plan/scripts/detect_versions.sh
```
This outputs JSON with `positronVersion`, `positronBuild`, `osVersion`. Report it to the user:
```
Target: Built app -- Positron 2026.02.0 (build 10), macOS 26.2
```

If `--branch` flag is present, this is a **diff-driven** test. The diff is the primary
signal; issue/PR context is enrichment only. `--branch` accepts an optional argument
that determines where the diff comes from:

- **No argument** (`--branch`): Diff current branch vs main
- **Branch name** (`--branch feature/my-branch`): Diff that branch vs main
- **Issue number** (`--branch #9638`): Find the PR that closed this issue, extract its
  diff. Also fetches the issue body as enrichment context. Works for merged PRs too.

To resolve an issue number to a diff:
```bash
# Find PRs linked to the issue
gh pr list --search "9638" --state all --repo posit-dev/positron --json number,title,headRefName --limit 5
# Get the diff from the most relevant PR
gh pr diff <pr-number> --repo posit-dev/positron
# Get the issue for enrichment
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
Parse into 3-8 concrete, ordered test steps. Each step becomes one entry in the `/run-plan` steps array.

**If issue number with `--quick`:**
1. Fetch the issue: `gh issue view <number> --repo posit-dev/positron --json title,body,labels`
2. Parse the issue body to identify expected behavior
3. **Validate testability** (see below)
4. Plan test steps

**If issue number (default):**
1. Run the `qa-test-plan` skill to generate a verification guide
2. **Validate testability** (see below)
3. Parse the guide into executable steps

**If --branch flag:**

Analyze the current branch's changes vs main to generate a test plan. The diff is the
primary signal -- PR context and issue context are enrichment only.

1. **Extract the diff:**

The diff source depends on what argument was passed to `--branch`:

**If no argument or a branch name:**
```bash
# Determine the target branch (default: current branch)
BRANCH=$(git rev-parse --abbrev-ref HEAD)  # or the specified branch name
COMMITS_AHEAD=$(git rev-list --count main..$BRANCH)

# File list for area mapping
git diff main...$BRANCH --name-only

# Full diff for semantic analysis (cap at 2000 lines to stay focused)
git diff main...$BRANCH | head -2000
```

**If an issue number (e.g., `--branch #9638`):**
```bash
# Find the PR that closed this issue
gh pr list --search "9638" --state all --repo posit-dev/positron --json number,title,headRefName --limit 5

# Get the diff from the most relevant PR
gh pr diff <pr-number> --repo posit-dev/positron | head -2000

# Get file list
gh pr diff <pr-number> --repo posit-dev/positron --name-only
```

2. **Fetch enrichment context (secondary signals, if available):**
```bash
# PR context (auto-detected from branch, or already known from issue resolution)
gh pr view --json title,body,number,comments 2>/dev/null

# Issue context (if issue number was passed with --branch)
gh issue view <number> --repo posit-dev/positron --json title,body,labels 2>/dev/null
```
If no PR exists and no issue number was passed, skip -- the diff alone is sufficient.

3. **Classify changed files:**

Group each changed file into one of these categories:
- **User-facing**: `src/vs/workbench/**`, `extensions/**` -- behavioral code, test these
- **Shared component**: `src/vs/base/**`, `src/vs/platform/**`, shared dialogs/modals -- note blast radius
- **Test infrastructure**: `test/e2e/pages/**`, `test/e2e/tests/explore/**` -- skip testing
- **Build/CI**: `build/**`, `scripts/**`, `.github/**` -- skip testing
- **Docs only**: `*.md`, `*.txt` -- skip testing

4. **Analyze diff hunks for user-facing files:**

For each user-facing file, read the actual diff hunks and determine:
- What methods, components, or behaviors were added, changed, or removed
- Whether the change is behavioral (logic) vs cosmetic (CSS, labels, strings)
- Whether it touches error handling, timeouts, or state management
- Blast radius: does this file affect shared components used by other features?

5. **Show transparent analysis to the user:**

Print this analysis BEFORE generating the test plan so the user sees exactly what
drove the plan. Use this format:

```
## Diff Analysis: <branch-name> (<N> commits ahead of main)

### Changes detected (user-facing)
- `src/.../file.ts`: <what changed -- e.g., "Added timeout parameter to show() method">
- `src/.../other.ts`: <what changed>

### Infrastructure changes (not testing)
- `test/e2e/pages/variables.ts`: POM update
- `build/gulpfile.js`: Build config

### Blast radius
- <area> (<reason> -- e.g., "shared modal component used by 4 dialogs")
- <area> (<reason>)

### PR context (secondary signal)
- PR #<number>: "<title>"
- <summary of body if relevant>
- Comments: <count> (<brief note if any mention blast radius or related areas>)

### Issue context (if provided)
- Issue #<number>: "<title>"
- <summary of expected behavior from issue body>
```

If the branch has NO user-facing changes (only infrastructure/docs), tell the user:
```
No user-facing changes detected on this branch. All changes are in test
infrastructure, build scripts, or documentation. Nothing to test with the
explore runner.
```

6. **Generate test plan:**

Based on the analysis, generate 3-8 test steps using the same format as the
free-text path. Apply these priorities:
- **Deep tests first**: Exercise the specific new/modified behavior and edge cases
- **Smoke tests second**: Quick happy-path checks for blast radius areas
- **Suggest existing tests**: If you spot existing test files that cover the changed
  areas (e.g., `test/e2e/tests/variables/variables-filter.test.ts`), mention them:
  ```
  Existing tests that cover this area (run separately):
  - test/e2e/tests/variables/variables-filter.test.ts
  - test/e2e/tests/data-explorer/data-explorer-summary.test.ts
  ```

Then continue to Step 2 (Start the Explore Runner) as normal. The diff analysis
replaces the free-text/issue parsing -- everything downstream is identical.

**Generate POM reference if missing:**
```bash
if [ ! -f test/e2e/tests/qa-generated/pom-reference.md ]; then
  npx tsx scripts/generate-pom-reference.ts
fi
```

**Read the POM reference** to get exact method names, parameter types, and available POMs:
```bash
Read test/e2e/tests/qa-generated/pom-reference.md
```

Use the reference to pick exact method names and parameter types for every POM step. **NEVER guess method names or parameter types** -- always consult the reference first.

**CRITICAL: Copy-paste method names from the reference. Do NOT abbreviate, shorten, or
paraphrase method names.** For example, the method is `openVariableInDataExplorer`, not
`doubleClickVariable`. The method is `waitForPlotInFullSizeViewer`, not `waitForFullSizeViewer`.
If you are not 100% certain of the exact method name, grep the reference before using it.

**CRITICAL: Read the `--` description after each method signature before choosing it.**
The description tells you WHEN to use the method. If it says "See also: X", read X too.
Common mistakes:
- `clickDatabaseIconForVariableRow` is unreliable. Use `openVariableInDataExplorer` instead.
- `expectVariableToBe` values must match exactly. Python DataFrames display as
  `[N rows x M columns] pandas.DataFrame`, not abbreviated formats.

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

Launch the Playwright test in the background. **Always** set `EXPLORE_TITLE` to a short, descriptive name (issue number + brief summary).

**For Electron (default -- local dev):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
EXPLORE_TITLE="QA #12381: Ctrl+C in .qmd with inline output" npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-electron 2>&1 &
```

**For Electron (built app -- macOS):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
BUILD=/Applications/Positron.app EXPLORE_TITLE="QA #12381: Ctrl+C in .qmd with inline output" npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-electron 2>&1 &
```

**For browser mode (Firefox, Chromium, WebKit):**
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
ALLOW_EXPLORE=1 EXPLORE_TITLE="QA #11593: Plots new window broken in Firefox" npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-firefox 2>&1 &
```
Note: `ALLOW_EXPLORE=1` is required for browser projects -- it removes the explore directory from testIgnore.

**Important:** Never use just the issue number. Always include a brief summary (under 60 chars).

**Poll for readiness.** The app fixture handles startup readiness, so once the port file exists and `/health` returns ok, the app is ready:
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
  sleep 2
done
```

This launches Positron as a real Electron app. It takes ~30-60 seconds to start.

**While the runner starts**, generate the POM reference if it was missing (this fills dead time):
```bash
npx tsx scripts/generate-pom-reference.ts &
```

Once ready, send a description so the report shows what is being tested. Use `jq` with `$'...'` for multi-line descriptions:
```bash
PORT=$(cat /tmp/explore-runner-port)
jq -n --arg desc $'Verify panel hiding behavior when closing editors:\n- Panel maximizes when visible and last editor closes\n- Panel stays hidden when user hid it (Cmd+J)\n- Panel stays hidden after reload' \
  '{description: $desc}' \
| curl -s -X POST "http://localhost:$PORT/describe" -H 'Content-Type: application/json' -d @-
```

### Step 3: Execute Test via /run-plan (Primary)

Use `POST /run-plan` to execute the entire test in one HTTP call. This replaces the batch-per-group workflow. A happy-path test run is **4 tool calls total**: launch + poll, read POM reference, POST /run-plan, POST /done.

#### /run-plan Request Format

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

**Request fields:**
- `title` (required): Descriptive label for the plan in the Playwright report (e.g., "QA #12345: Variable appears after execution")
- `steps` (required): Array of step objects (same `BatchStep` type as `/batch`)
- `stepTimeout` (optional): Default timeout in ms for all steps (default 10000)
- `resetBefore` (optional): Run state reset before executing (set true on retries)

**Step fields:**
- `type` (required): `"pom"` or `"action"`
- For `"pom"`: `pom`, `method`, `args`, `scope` (same as `/pom` route)
- For `"action"`: `action`, `params` (same as `/action` route)
- `title` (optional): Human-readable label for Playwright report
- `timeout` (optional): Per-step timeout override in ms (falls back to `stepTimeout`)

#### Dynamic content with jq

Use **`jq -n` piped to `curl -d @-`** when the payload contains code, text with quotes/newlines, or any dynamic strings:
```bash
jq -n --arg code $'x = 42\nprint(x)' \
  '{title: "Run code and verify", stepTimeout: 10000, steps: [
    {type: "pom", pom: "console", method: "executeCode", args: ["Python", $code], title: "Execute code"},
    {type: "pom", pom: "variables", method: "expectVariableToBe", args: ["x", "42"], timeout: 5000, title: "Verify x"}
  ]}' \
| curl -s -X POST "http://localhost:$PORT/run-plan" -H 'Content-Type: application/json' -d @-
```

**IMPORTANT: `jq --arg` does NOT interpret `\n` as newlines.** Use bash `$'...'` quoting for any string containing newlines:
- WRONG: `--arg code 'line1\nline2'` -- types literal backslash-n
- RIGHT: `--arg code $'line1\nline2'` -- types actual newline

**Rule of thumb:** If the value contains quotes, newlines, backslashes, or comes from a variable -- use `jq` with `$'...'` quoting. Otherwise plain `curl` is fine and faster.

#### /run-plan Response Format

**Success (all steps pass):**
```json
{
  "passed": 3, "failed": 0,
  "steps": [
    {"title": "Start Python", "success": true, "duration": 2100},
    {"title": "Execute code", "success": true, "duration": 800},
    {"title": "Verify variable", "success": true, "duration": 400}
  ],
  "totalDuration": 3300,
  "state": {
    "activeEditor": null, "consoleLinesCount": 12,
    "variableCount": 1, "variableNames": ["x"],
    "sessionCount": 1, "activeSession": "Python: idle",
    "notifications": [], "openTabs": [], "focusedPanel": "console"
  }
}
```

**Failure (at step 2 of 3):**
```json
{
  "passed": 1, "failed": 1,
  "steps": [
    {"title": "Start Python", "success": true, "duration": 2100},
    {"title": "Execute code", "success": false, "error": "Timeout 10000ms exceeded", "duration": 10023}
  ],
  "skipped": 1, "totalDuration": 12123,
  "state": {
    "variableCount": 0, "variableNames": [],
    "notifications": ["Interpreter disconnected"],
    "activeSession": "Python: idle"
  }
}
```

The enriched `state` object provides diagnostic context without needing snapshots or screenshots:
- `variableNames` -- check which variables are set
- `activeSession` -- confirm session language and status (e.g., "Python: idle", "R: busy")
- `notifications` -- spot error toasts or interpreter messages
- `openTabs` -- see which editors are open
- `focusedPanel` -- confirm focus landed where expected

#### Scoping for side-by-side notebooks

Add `"scope": 0` or `"scope": 1` to scope all locators to a specific editor group:
```json
{"type": "pom", "pom": "notebooksPositron", "method": "addCodeToCell", "args": [0, "y = 100"], "scope": 1, "title": "Add code to right notebook"}
```

#### When to assert

Add a verification step after an action when:
1. **The target is ambiguous** -- e.g., two notebooks open, verify code landed in the right one
2. **The test hinges on the result** -- a later step depends on this having worked
3. **Shared state changed** -- verify with `expectVariable`, `getSessionCount`, etc.

Do NOT assert after every action -- `clickTab`, `startSession`, `expectEditorGroupCount` have built-in waits.

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

4. **If both attempts fail**: switch to Explore Mode (Step 3c) for interactive diagnosis, or report the failure.

5. **Track divergences for POM Health reporting.** When a retry succeeds with a different
   POM method or a raw Playwright fallback, note the original method, the replacement,
   and whether either had JSDoc in the reference. Report this in Step 4 under POM Health.

### Step 3c: Explore Mode (Fallback)

Use explore mode when `/run-plan` fails and you need to diagnose interactively. This is NOT the primary workflow -- use `/run-plan` first, always.

The runner has three additional routes for interactive exploration: `POST /pom` for single POM calls, `POST /action` for custom/raw actions, and `POST /batch` for multi-step sequences.

#### POM calls (`POST /pom`)

Call any POM method directly:
```bash
PORT=$(cat /tmp/explore-runner-port)
curl -s -X POST "http://localhost:$PORT/pom" \
  -H 'Content-Type: application/json' \
  -d '{"pom": "sessions", "method": "start", "args": ["python"], "title": "Start Python session"}'
```

**Request fields:**
- `pom` (required): Workbench property name -- `"sessions"`, `"console"`, `"variables"`, `"dataExplorer"`, `"plots"`, `"notebooksPositron"`, `"editors"`, `"hotKeys"`, `"quickaccess"`, `"settings"`, `"assistant"`, etc. Supports **dotted paths** for sub-objects: `"dataExplorer.grid"`, `"dataExplorer.summaryPanel"`, `"dataExplorer.filters"`.
- `method` (required): Method name on the POM class
- `args` (optional): Positional arguments array (default `[]`)
- `scope` (optional): Editor group index for side-by-side scoping
- `title` (optional): Human-readable label for Playwright report

#### Custom + Raw actions (`POST /action`)

For actions with custom logic and raw Playwright:

```bash
# Static params -- plain curl:
curl -s -X POST "http://localhost:$PORT/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "openFile", "params": {"path": "README.md"}, "title": "Open README"}'

# Dynamic code/text -- jq piped to curl:
jq -n --arg code 'print("hello world")' \
  '{action: "addCodeToCell", params: {cellIndex: 0, code: $code, clearCell: true}, title: "Add code to cell 0"}' \
| curl -s -X POST "http://localhost:$PORT/action" -H 'Content-Type: application/json' -d @-
```

**Custom actions** (logic beyond a single POM call):

| Action | Params | Description |
|--------|--------|-------------|
| `openFile` | `{"path": "README.md"}` | Open file (workspace-relative, handles non-text files) |
| `openDataFile` | `{"path": "data.csv"}` | Open data file in Data Explorer |
| `newNotebook` | `{"codeCells?": 1, "markdownCells?": 0, "language?": "Python" (default), "clearCells?": true}` | Create notebook; defaults to Python kernel (pass `null` to skip) |
| `runCodeInEditor` | `{"code": "x <- 42", "language?": "r"}` | Write code to temp file and execute via Cmd+Enter |
| `contextMenu` | `{"selector": ".el", "menuItem": "Pin Row", "button?": "right"}` | Right-click and select from context menu (handles native macOS menus) |
| `getChatResponseText` | `{}` | Get assistant response (needs workspace path) |
| `getAvailableTools` | `{}` | Get assistant tools (needs workspace path) |

**Raw Playwright actions** (flexible, for recovery and debugging):

| Action | Params | Description |
|--------|--------|-------------|
| `snapshot` | `{"maxLength?": 8000}` | Get accessibility tree |
| `clickText` | `{"text": "OK", "exact?": false}` | Click by visible text |
| `clickRole` | `{"role": "button", "name": "OK"}` | Click by accessible role |
| `clickSelector` | `{"selector": ".cls"}` | Click by CSS selector |
| `fill` | `{"text": "hello", "role?": "textbox"}` | Fill input |
| `press` | `{"key": "Escape"}` | Press keyboard key |
| `type` | `{"text": "hello world", "delay?": 0}` | Type text into focused element (Monaco, console, etc.) |
| `waitForText` | `{"text": "Ready"}` | Wait for text |
| `waitForSelector` | `{"selector": ".loaded"}` | Wait for selector |
| `takeScreenshot` | `{"name?": "test"}` | Save screenshot to /tmp/ |
| `evaluate` | `{"expression": "document.title"}` | Run JS in renderer |
| `resizeWindow` | `{"width": 600, "height": 800}` | Resize Electron window |
| `getWindowSize` | `{}` | Get window dimensions |

#### Batch execution (`POST /batch`)

Send multiple steps in one request for interactive sequences:
```bash
curl -s -X POST "http://localhost:$PORT/batch" \
  -H 'Content-Type: application/json' \
  -d '{"title": "Debug step", "steps": [
    {"type": "action", "action": "snapshot", "params": {"maxLength": 8000}, "title": "Snapshot UI"},
    {"type": "pom", "pom": "console", "method": "waitForReady", "args": [">>>"], "title": "Wait for console"}
  ]}'
```

#### POM first, raw never (for assertions)

Do NOT use raw selectors, evaluate, or screenshots for verification when a POM method exists. Look for `expect*` and `waitFor*` methods in the POM reference -- these are assertion methods with built-in retries.

Raw actions (`snapshot`, `takeScreenshot`) are for **debugging failures**, not for assertions.

### Step 4: Report Results

Use the `/run-plan` response fields to report results. For each step:
```
Step N: [title]
  Result: PASS / FAIL
  Duration: [duration]ms
  Error: [error message, if failed]
```

Summary format:
```
## QA Test: #12345 -- Variable appears after execution

Target: Local dev (Electron)
Browser: e2e-electron

### Result: PASSED (3/3 steps, 3.3s)

Step 1: Start Python session ............ PASS (2100ms)
Step 2: Execute x = 42 .................. PASS (800ms)
Step 3: Verify x in Variables pane ....... PASS (400ms)
```

**IMPORTANT: If a retry was needed**, even if the final result is PASSED, change the
header to `PASSED after retry` so the user knows it was not a clean pass.

When any step fails, change the header to make the failure obvious:

```
### Result: FAILED (2/3 steps passed, 1 FAILED, 12.1s)

  Failed step: "Verify outline contains [Introduction, Data Loading, Analysis]"
  Error: Timeout 10000ms exceeded
  State: notifications=["Interpreter disconnected"], variableCount=0

Step 1: Start Python session ............ PASS (2100ms)
Step 2: Execute x = 42 .................. PASS (800ms)
Step 3: Verify x in Variables pane ....... FAIL (10023ms)

### State after test
- Active session: Python: idle
- Variables: x
- Notifications: (none)
- Focused panel: console

### POM Recommendations
[Only include if you had to fall back to raw Playwright actions, retry with
a different approach, or work around a missing/insufficient POM method.
Skip this section if all steps used POM methods successfully.]

File: test/e2e/pages/<pom>.ts

/**
 * Action: <What this method does, one line.>
 * <Why it's needed -- what ambiguity or gap it fixes.>
 * @param <name> - <description>
 */
async <methodName>(<params>): Promise<void> {
	await test.step(`<Human-readable step label>`, async () => {
		<implementation using scoped locators>
	});
}

Rules:
- Actions: docstring starts with `Action:`, descriptive method name
- Verifications: docstring starts with `Verify:`, method named `expect<Thing>()`
- Always wrap body in `test.step()` with a readable label
- Use `@param` tags for each parameter
- Use scoped locators (container-first) to avoid ambiguity
- Return `Promise<void>`

### POM Health
[Include when the skill retried a step with a different POM method, or fell
back to raw Playwright actions. Categorize each finding. Skip this section
if all steps used POM methods successfully on the first attempt.]

**Method Confusion** (retried with a different POM method that succeeded):
- CONFUSION: Called `<original>` (failed), retried with `<replacement>` (passed).
  JSDoc on original: <present/missing>. JSDoc on replacement: <present/missing>.
  Recommendation: <Add @see cross-references / Update JSDoc to clarify distinction>

**POM Gap** (fell back to raw Playwright because no POM method existed):
- GAP: Used raw `<action>` with selector `<selector>` because no POM method covers <intent>.
  Suggested POM: <pom>.ts
  Suggested method: `<methodName>(<params>): Promise<void>`

When a POM Gap is detected, also auto-append it to `test/e2e/tests/explore/BACKLOG.md`
under `## POM Gaps`:

- [ ] **Missing: <methodName> (<pom>.ts)**
  During QA test "<test title>", no POM method existed for <intent>.
  Used raw `<action>` with `<selector>`.
  Suggested signature: `<methodName>(<params>): Promise<void>`
  Discovered: <date>

### Rough edges
- [Any UX issues, slow transitions, or unexpected behaviors noticed]
- [Even on passing tests, report anything that felt wrong]

### Retry summary
[REQUIRED if /run-plan was called more than once. Put this at the bottom
of the report so the clean results are visible first.]

**Attempt 1 failed at:** Step N "<title>"
- Error: <error message>
- Root cause: <what was wrong -- wrong expected value, wrong method name, timeout too short, etc.>

**Fix applied:** <what was changed for the retry>

This section MUST appear whenever a retry occurred. Never omit it.
```

If any step fails, include the error message and enriched state. Use `snapshot` or `takeScreenshot` only if the enriched state is not sufficient to diagnose.

### Step 5: Cleanup and Save Prompt

```bash
curl -s -X POST "http://localhost:$PORT/done"
```

**After reporting results and sending `/done`, handle saving:**
- `--save`: Save the test file immediately (go to Step 6, no prompt needed)
- `--no-save`: Do not save, do not prompt. Done.
- **No flag (default): You MUST ask the user using `AskUserQuestion`:**

Use `AskUserQuestion` with this exact question:
> "Would you like to save this as a reusable test file?"

**Do NOT skip this prompt.** This applies even if:
- The test required retries (the corrected steps are what gets saved)
- Some steps failed but the core scenario worked (save the passing steps)
- The result was "PASSED after retry"

Wait for the user's answer before proceeding.
If yes, generate the `.test.ts` file following Step 6 format, using the CORRECTED
method names and values from the successful retry (not the original failed attempt).

### Step 6: Save Test

Write a standalone `.test.ts` file when saving (via `--save` flag, or user said yes to prompt).

**File path:** `test/e2e/tests/qa-generated/qa-<issueNumber>-<slug>.test.ts`
- `<slug>` is a short kebab-case summary (e.g., `variable-pane-update`)
- Example: `test/e2e/tests/qa-generated/qa-12345-variable-pane-update.test.ts`

**Format:**
```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA #12345: Variable appears after execution', async function ({ app, python }) {
	const { console, variables } = app.workbench;

	// Execute code and verify variable
	await console.executeCode('Python', 'x = 42');
	await variables.expectVariableToBe('x', '42');
});
```

**Rules:**
- Import from `./_qa.setup`, not `../_test.setup`
- Always include `test.use({ suiteId: __filename })` for app isolation
- Use `function` syntax (not arrow functions) for fixture access
- Use tabs for indentation
- **Use fixtures instead of manual session starts:**
  - Test needs Python? Use the `python` fixture -- it auto-starts the interpreter
  - Test needs R? Use the `r` fixture
  - Test needs both? Use `sessions` fixture and start manually
  - Test doesn't need an interpreter? Just use `app`
- Destructure `app.workbench` at the top of the test body for cleaner calls
- Do NOT wrap POM calls in `test.step()` -- POM methods already have their own internal `test.step()` wrappers
- Map action steps to the equivalent Playwright calls
- Add a short comment before each logical group of actions (one comment per line-group, not per call). The comment describes intent, not code. Separate groups with a blank line. Style reference: `test/e2e/tests/variables/variables-filter.test.ts`

## Error Handling

- **Runner not starting**: Ensure build daemons are running (`npm run build-start`).
- **Action fails**: Read the enriched state first. Use `snapshot` in explore mode to see the UI if state is insufficient.
- **Unknown POM or method**: The response lists available options. Cross-check with pom-reference.md.
- **Runner timeout**: Auto-stops after 10 minutes. Send `/health` to keep alive.

## Artifacts

Playwright trace is captured automatically. Use `takeScreenshot` or `snapshot` for on-demand evidence.

## Tips

- The enriched `state` object after `/run-plan` shows variable names, session status, notifications, open tabs, and focused panel -- often enough to diagnose failures without snapshots.
- POM methods via `/pom` and `/run-plan` wait for completion -- no manual delays needed.
- `snapshot` returns the accessibility tree -- search for roles, names, states. Use in explore mode only.
- Raw actions default to 5s timeout, POM actions to 10s. Override with `timeout` field on any step.
- Data Explorer `columnIndex` is 1-based. `rowIndex`/`colIndex` for cells are 0-based.
- Pinned row headers show the **source row index**: Python/pandas is 0-based (row position 1 -> header "1"), R is 1-based (row position 1 -> header "2"). Use the matching index system when calling `expectRowsToBePinned`.
- String variables display with language-specific quoting: Python shows `'hello'` (single quotes), R shows `"hello"` (double quotes). Include the quotes when calling `expectVariableToBe`.
- POM reference file at `test/e2e/tests/qa-generated/pom-reference.md` has full TypeScript signatures -- always read it before planning steps.
- POM source files are in `test/e2e/pages/` -- read them if you need to check union types or complex parameter shapes beyond what the reference shows.
- **Always include a `title`** on every step and on the `/run-plan` request for readable Playwright reports.
