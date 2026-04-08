# Runner API Reference

## /run-plan Request Format

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

**Request fields:**
- `title` (required): Descriptive label for the plan in the Playwright report (e.g., "PR 456: Variable appears after execution")
- `steps` (required): Array of step objects (same `BatchStep` type as `/batch`)
- `stepTimeout` (optional): Default timeout in ms for all steps (default 10000)
- `resetBefore` (optional): Run state reset before executing (set true on retries)

**Step fields:**
- `type` (required): `"pom"` or `"action"`
- For `"pom"`: `pom`, `method`, `args`, `scope` (same as `/pom` route)
- For `"action"`: `action`, `params` (same as `/action` route)
- `title` (optional): Human-readable label for Playwright report
- `timeout` (optional): Per-step timeout override in ms (falls back to `stepTimeout`)

## Dynamic content with jq

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

## /run-plan Response Format

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

## Scoping for side-by-side notebooks

Add `"scope": 0` or `"scope": 1` to scope all locators to a specific editor group:
```json
{"type": "pom", "pom": "notebooksPositron", "method": "addCodeToCell", "args": [0, "y = 100"], "scope": 1, "title": "Add code to right notebook"}
```

## When to assert

Add a verification step after an action when:
1. **The target is ambiguous** -- e.g., two notebooks open, verify code landed in the right one
2. **The test hinges on the result** -- a later step depends on this having worked
3. **Shared state changed** -- verify with `expectVariable`, `getSessionCount`, etc.

Do NOT assert after every action -- `clickTab`, `startSession`, `expectEditorGroupCount` have built-in waits.

## Explore Mode (Step 3c -- Fallback)

Use explore mode when `/run-plan` fails and you need to diagnose interactively. This is NOT the primary workflow -- use `/run-plan` first, always.

The runner has three additional routes for interactive exploration: `POST /pom` for single POM calls, `POST /action` for custom/raw actions, and `POST /batch` for multi-step sequences.

### POM calls (`POST /pom`)

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

### Custom + Raw actions (`POST /action`)

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

### Batch execution (`POST /batch`)

Send multiple steps in one request for interactive sequences:
```bash
curl -s -X POST "http://localhost:$PORT/batch" \
  -H 'Content-Type: application/json' \
  -d '{"title": "Debug step", "steps": [
    {"type": "action", "action": "snapshot", "params": {"maxLength": 8000}, "title": "Snapshot UI"},
    {"type": "pom", "pom": "console", "method": "waitForReady", "args": [">>>"], "title": "Wait for console"}
  ]}'
```
