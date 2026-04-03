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
```

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

### Step 1: Parse Input and Plan Test Steps

**If free-text description:**
Parse into 3-8 concrete, ordered test steps. Prefer POM actions for structured steps; use raw actions for exploration or recovery.

**Then group steps into batches.** Each batch is a `POST /batch` call. Only split into a new batch when you need to inspect the result before deciding the next action. Most test scenarios need 2-4 batches, not 8+ individual calls.

Example grouping for "start R, create df, open in Data Explorer, show summary, pin row":
- **Batch 1** (setup): `executeCode` + `waitForVariableRow`
- **Batch 2** (explore): `doubleClickVariableRow` + `summaryPanel.show` + `expandColumnProfile` + `expectColumnProfileToBeExpanded`
- **Batch 3** (pin + verify): `pinRow` + `expectRowsToBePinned`

That's 3 round-trips instead of 8. **Default to batching; single-step only when branching.**

**If issue number with `--quick`:**
1. Fetch the issue: `gh issue view <number> --repo posit-dev/positron --json title,body,labels`
2. Parse the issue body to identify expected behavior
3. **Validate testability** (see below)
4. Plan test steps using the action catalog

**If issue number (default):**
1. Run the `qa-test-plan` skill to generate a verification guide
2. **Validate testability** (see below)
3. Parse the guide into executable steps

#### Testability Check

Before starting the runner, confirm the issue can actually be tested with this framework. **Stop and tell the user** if the issue:

- **Requires a different OS**: WSL, Windows-only, Linux-only issues cannot be tested on macOS
- **Requires remote connections**: SSH, WSL, Docker remote host, Codespaces
- **Requires specific hardware**: GPU, multiple monitors, specific screen sizes beyond `resizeWindow`
- **Is a packaging/deployment issue**: CDN URLs, installers, update mechanisms, server downloads
- **Requires external services**: specific databases, cloud APIs, authenticated services not in the workspace
- **Is purely about build/CI**: GitHub Actions, CI pipelines, build scripts
- **Requires specific data that doesn't exist**: proprietary datasets, large files, credentials

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

Wait for the runner to be ready by polling the port file. The `/health` response includes the full POM catalog, so save it:
```bash
for i in $(seq 1 60); do
  if [ -f /tmp/explore-runner-port ]; then
    PORT=$(cat /tmp/explore-runner-port)
    HEALTH=$(curl -s "http://localhost:$PORT/health" 2>/dev/null)
    if echo "$HEALTH" | grep -q ok; then
      echo "Runner ready on port $PORT"
      echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'{k}: {', '.join(v)}') for k,v in d.get('catalog',{}).items()]" > /tmp/explore-catalog.txt 2>/dev/null
      break
    fi
  fi
  sleep 2
done
```

This launches Positron as a real Electron app. It takes ~30-60 seconds to start. The catalog is available immediately -- no separate fetch needed.

**While the runner starts**, prepare batch payloads, plan test steps, and build `jq` commands. The runner startup is dead time -- use it. Only the final `curl` call needs the port.

Once ready, send a description so the report shows what is being tested. Use `jq` with `$'...'` for multi-line descriptions:
```bash
PORT=$(cat /tmp/explore-runner-port)
jq -n --arg desc $'Verify panel hiding behavior when closing editors:\n- Panel maximizes when visible and last editor closes\n- Panel stays hidden when user hid it (Cmd+J)\n- Panel stays hidden after reload' \
  '{description: $desc}' \
| curl -s -X POST "http://localhost:$PORT/describe" -H 'Content-Type: application/json' -d @-
```

### Step 3: Execute Test Steps

**Execute batches from your plan, not individual steps.** Use `POST /batch` for each group of steps that don't require branching. Only fall back to single `POST /pom` or `POST /action` calls when you need to inspect a result before deciding the next action (e.g., error recovery, conditional logic).

The runner has **three routes**: `POST /batch` (preferred), `POST /pom` for single POM calls, and `POST /action` for custom/raw actions.

#### JSON payloads: `jq` for dynamic content, plain `curl` for static

Use **plain `curl -d`** when the JSON has no dynamic strings (no user code, no quotes, no newlines):
```bash
curl -s -X POST "http://localhost:$PORT/pom" \
  -H 'Content-Type: application/json' \
  -d '{"pom": "sessions", "method": "start", "args": ["python"], "title": "Start Python session"}'
```

Use **`jq -n` piped to `curl -d @-`** when the payload contains code, text with quotes/newlines, or any dynamic strings. `jq --arg` handles JSON escaping (quotes, special chars) automatically:
```bash
jq -n --arg code $'x = "hello"\nprint(x)' \
  '{pom: "notebooksPositron", method: "addCodeToCell", args: [1, $code], title: "Add code to cell"}' \
| curl -s -X POST "http://localhost:$PORT/pom" -H 'Content-Type: application/json' -d @-
```

**IMPORTANT: `jq --arg` does NOT interpret `\n` as newlines.** Use bash `$'...'` quoting for any string containing newlines:
- WRONG: `--arg code 'line1\nline2'` -- types literal backslash-n
- RIGHT: `--arg code $'line1\nline2'` -- types actual newline

**Rule of thumb:** If the value contains quotes, newlines, backslashes, or comes from a variable -- use `jq` with `$'...'` quoting. Otherwise plain `curl` is fine and faster.

#### Route 1: POM calls (`POST /pom`) -- preferred

Call any POM method directly. No wrappers needed -- the router resolves `app.workbench[pom]` and calls `method(...args)` via reflection.

```bash
PORT=$(cat /tmp/explore-runner-port)
curl -s -X POST "http://localhost:$PORT/pom" \
  -H 'Content-Type: application/json' \
  -d '{"pom": "sessions", "method": "start", "args": ["python"], "title": "Start Python session"}'
```

**Request fields:**
- `pom` (required): Workbench property name -- `"sessions"`, `"console"`, `"variables"`, `"dataExplorer"`, `"plots"`, `"notebooksPositron"`, `"editors"`, `"hotKeys"`, `"quickaccess"`, `"settings"`, `"assistant"`, etc. Supports **dotted paths** for sub-objects: `"dataExplorer.grid"`, `"dataExplorer.summaryPanel"`, `"dataExplorer.filters"`. The catalog lists all available sub-objects.
- `method` (required): Method name on the POM class
- `args` (optional): Positional arguments array (default `[]`)
- `scope` (optional): Editor group index for side-by-side scoping (calls `scopedTo(editorGroup(N))`)
- `title` (optional): Human-readable label for Playwright report

**Scoping for side-by-side notebooks:** Add `"scope": 0` or `"scope": 1` to scope all locators to a specific editor group. Only works on POMs that support `scopedTo()` (currently `notebooksPositron`).

```bash
# Add code to the RIGHT notebook (group 1) -- scoped, no global cell.nth(0) leakage
jq -n --arg code 'y = 100' \
  '{pom: "notebooksPositron", method: "addCodeToCell", args: [0, $code], scope: 1, title: "Add code to right notebook"}' \
| curl -s -X POST "http://localhost:$PORT/pom" -H 'Content-Type: application/json' -d @-
```

**Error handling:** If the POM or method doesn't exist, the response includes available options:
```json
{"success": false, "error": "Unknown method: \"foo\" on POM \"sessions\". Available: deleteAll, expectAllReady, ..."}
```

**Always use the catalog to find method names and signatures.** The catalog is fetched at startup from `/health` and saved to `/tmp/explore-catalog.txt`. It includes both top-level POMs and dotted sub-objects (e.g. `dataExplorer.grid`, `dataExplorer.summaryPanel`). Never hardcode or guess method names -- they change.

#### Route 2: Custom + Raw actions (`POST /action`)

For actions with custom logic (path resolution, multi-step flows) and raw Playwright:

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

**Raw Playwright actions** (flexible, for recovery):

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

#### Route 3: Batch execution (`POST /batch`) -- fastest

Send multiple steps in one request. The server executes them sequentially, skips `observeState` on intermediate steps, and stops at the first failure. Use this for predetermined setup/action sequences where you don't need to branch between steps.

```bash
# Static batch -- plain curl (always include a "title" for the report):
curl -s -X POST "http://localhost:$PORT/batch" \
  -H 'Content-Type: application/json' \
  -d '{"title": "Reorder cells", "steps": [
    {"type": "pom", "pom": "notebooksPositron", "method": "addCell", "args": ["markdown"], "title": "Add markdown cell"},
    {"type": "pom", "pom": "notebooksPositron", "method": "selectCellAtIndex", "args": [0], "title": "Select cell 0"},
    {"type": "action", "action": "press", "params": {"key": "Alt+ArrowDown"}, "title": "Move cell down"}
  ]}'

# Dynamic batch with code -- jq piped to curl (use $'...' for newlines):
jq -n --arg code $'x = 42\nprint(x)' \
  '{steps: [
    {type: "action", action: "addCodeToCell", params: {cellIndex: 0, code: $code, clearCell: true}, title: "Add code to cell 0"},
    {type: "pom", pom: "notebooksPositron", method: "runCodeAtIndex", args: [0], title: "Run cell 0"},
    {type: "pom", pom: "notebooksPositron", method: "expectOutputAtIndex", args: [0, ["42"]], title: "Verify output"}
  ]}' \
| curl -s -X POST "http://localhost:$PORT/batch" -H 'Content-Type: application/json' -d @-
```

**Request fields:**
- `title` (required): Descriptive label for the batch group in the Playwright report (e.g., "Setup notebook and add code", "Verify headings and reorder cells")
- `steps` (required): Array of step objects

**Step fields:**
- `type` (required): `"pom"` or `"action"`
- For `"pom"`: `pom`, `method`, `args`, `scope` (same as `/pom` route)
- For `"action"`: `action`, `params` (same as `/action` route)
- `title` (optional): Label for individual step in the Playwright report

**Response (success):**
```json
{
  "completed": [
    {"success": true, "result": "ok", "state": {}, "duration": 242},
    {"success": true, "result": "ok", "state": {}, "duration": 85},
    {"success": true, "result": "Pressed: Alt+ArrowDown", "state": {}, "duration": 53}
  ],
  "skipped": 0,
  "state": {"activeEditor": "Untitled-1.ipynb", "variableCount": 1, "plotVisible": false}
}
```

**Response (fail-fast at step 2 of 5):**
```json
{
  "completed": [
    {"success": true, "result": "ok", "state": {}, "duration": 242}
  ],
  "failed": {"success": false, "error": "...", "state": {...}, "index": 1, "duration": 5023},
  "skipped": 3,
  "state": {"activeEditor": "Untitled-1.ipynb"}
}
```

Note: intermediate `completed` steps have empty `state: {}` -- state is only observed once at the end (or at the failure point). This eliminates ~500ms of overhead per step.

**When to batch vs single-step:**
- **Batch**: setup sequences, cell creation + content + run, multi-step assertions that don't branch
- **Single-step**: steps where the next action depends on the result, recovery flows, debugging

#### Response format (all routes)

```json
{
  "success": true,
  "result": "ok",
  "state": {
    "activeEditor": "Untitled-1",
    "consoleLinesCount": 5,
    "variableCount": 0,
    "plotVisible": false
  },
  "duration": 1234
}
```

#### Decision tree

1. **Default: batch.** Group all consecutive steps that don't require branching into a single `POST /batch`. This is the right choice 80% of the time.
2. **Need to branch on a result?** -> Single `POST /pom` or `POST /action`, then decide next batch.
3. **Error recovery?** -> Single `POST /action` with Raw actions (`snapshot`, `clickText`, `press`).
4. **Side-by-side notebooks?** -> `POST /batch` with `"scope": N` to scope locators to an editor group.

#### When to assert

Add a verification step after an action when:
1. **The target is ambiguous** -- e.g., two notebooks open, verify code landed in the right one
2. **The test hinges on the result** -- a later step depends on this having worked
3. **Shared state changed** -- verify with `expectVariable`, `getSessionCount`, etc.

Do NOT assert after every action -- `clickTab`, `startSession`, `expectEditorGroupCount` have built-in waits.

#### Discover before calling -- NEVER guess method names

The full POM catalog is included in the `/health` response automatically -- no separate fetch needed. It's available the moment the runner is ready (saved to `/tmp/explore-catalog.txt` by the poll loop above).

To re-fetch or filter the catalog mid-session:
```bash
PORT=$(cat /tmp/explore-runner-port)
# Filtered to specific POMs:
curl -s "http://localhost:$PORT/catalog?pom=sessions,console,variables" | python3 -m json.tool
```

The catalog is a JSON object mapping POM names to method signatures:
```json
{
  "sessions": [
    "select(sessionIdOrName, waitForSessionIdle = false)",
    "start(sessions, options)",
    "expectStatusToBe(sessionIdOrName, expectedStatus, options)",
    ...
  ],
  "console": [
    "executeCode(languageName, code, options)",
    "clickDuplicateSessionButton()",
    ...
  ],
  ...
}
```

**Use the catalog for every POM call.** Pick method names from the catalog -- never guess. The catalog is pre-computed at startup (synchronous prototype reflection, takes milliseconds).

**If unsure about a method's parameter types or values**, read the POM source file in `test/e2e/pages/` before calling. The catalog shows parameter names but not TypeScript union types.

**The workflow:**
1. The catalog arrives with the `/health` response -- no extra call needed
2. For every POM call, pick the method from the catalog -- never guess
3. If parameter types are unclear (e.g., union types like `"active" | "idle"`), read the POM source in `test/e2e/pages/`
4. Call with the correct name and args

#### POM first, raw never (for assertions)

Do NOT use raw selectors, evaluate, or screenshots for verification when a POM method exists. Look for `expect*` and `waitFor*` methods in the catalog -- these are assertion methods with built-in retries.

Raw actions (`snapshot`, `takeScreenshot`) are for **debugging failures**, not for assertions.

**Always include a `title`** on every request for readable Playwright reports.

### Step 4: Report Results

For each test step, report:
```
Step N: [description]
  Action: [action name and params]
  Result: PASS / FAIL
  Evidence: [result string or error]
```

If any step fails, take a `snapshot` to see UI state, then `takeScreenshot` for visual evidence.

### Step 5: Cleanup

```bash
curl -s -X POST "http://localhost:$PORT/done"
```

## Error Handling

- **Runner not starting**: Ensure build daemons are running (`npm run build-start`).
- **Action fails**: Use `snapshot` to see the UI, handle obstacles with raw actions, retry.
- **Unknown action**: The response lists all available actions.
- **Runner timeout**: Auto-stops after 10 minutes. Send `/health` to keep alive.

## Artifacts

Playwright trace is captured automatically. Use `takeScreenshot` or `snapshot` for on-demand evidence.

## Tips

- `state` object after every action shows console lines, variable count, active editor, plot visibility.
- POM methods via `/pom` wait for completion -- no manual delays needed.
- `snapshot` returns the accessibility tree -- search for roles, names, states.
- Raw actions default to 5s timeout, POM actions to 10s. Override with `timeout` param.
- Data Explorer `columnIndex` is 1-based. `rowIndex`/`colIndex` for cells are 0-based.
- Pinned row headers show the **source row index**: Python/pandas is 0-based (row position 1 -> header "1"), R is 1-based (row position 1 -> header "2"). Use the matching index system when calling `expectRowsToBePinned`.
- String variables display with language-specific quoting: Python shows `'hello'` (single quotes), R shows `"hello"` (double quotes). Include the quotes when calling `expectVariableToBe`.
- To discover methods: send `{"pom": "X", "method": "?"}` -- the error lists all available methods.
- To discover POMs: send `{"pom": "?", "method": "?"}` -- the error lists all workbench properties.
- POM source files are in `test/e2e/pages/` -- read them to check method signatures.
