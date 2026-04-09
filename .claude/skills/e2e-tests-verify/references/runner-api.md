# Runner API Reference

## /run-plan Request Format

```bash
PORT=$(cat /tmp/explore-runner-port) && curl -s -X POST "http://localhost:${PORT}/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{"title": "PR 456: Variable appears after execution", "stepTimeout": 10000, "steps": [
    {"type": "pom", "pom": "sessions", "method": "start", "args": ["python"], "timeout": 20000, "title": "Start Python session"},
    {"type": "pom", "pom": "console", "method": "executeCode", "args": ["Python", "x = 42"], "title": "Execute x = 42"},
    {"type": "pom", "pom": "variables", "method": "expectVariableToBe", "args": ["x", "42"], "timeout": 5000, "title": "Verify x in Variables pane"}
  ]}'
```

**Request fields:**
- `title` (required): Descriptive label for the Playwright report
- `steps` (required): Array of step objects
- `stepTimeout` (optional): Default timeout in ms for all steps (default 10000)
- `resetBefore` (optional): Run state reset before executing (set true on retries)

**Step fields:**
- `type` (required): `"pom"` or `"action"`
- For `"pom"`: `pom`, `method`, `args`, `scope`
- For `"action"`: `action`, `params`
- `title` (optional): Human-readable label for Playwright report
- `timeout` (optional): Per-step timeout override in ms

## Dynamic content

**Do NOT use `$'...'` bash syntax.** Use heredocs or plain curl instead.

**For simple payloads**, use plain curl (see example above).

**For payloads with code containing newlines**, use a heredoc:
```bash
PORT=$(cat /tmp/explore-runner-port)
cat <<'PAYLOAD' | curl -s -X POST "http://localhost:${PORT}/run-plan" -H 'Content-Type: application/json' -d @-
{
  "title": "PR 456: Run multiline code",
  "steps": [
    {"type": "pom", "pom": "console", "method": "executeCode", "args": ["Python", "x = 42\nprint(x)"], "title": "Execute code"}
  ]
}
PAYLOAD
```

Note: In JSON strings, `\n` is a literal newline escape -- no special bash quoting needed.

## /run-plan Response Format

**Success:**
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
    "variableCount": 1, "variableNames": ["x"],
    "activeSession": "Python: idle",
    "notifications": [], "openTabs": [], "focusedPanel": "console"
  }
}
```

The `state` object provides diagnostic context: `variableNames`, `activeSession`, `notifications`, `openTabs`, `focusedPanel`.

## Available actions for /run-plan steps

**Custom actions** (`type: "action"`):

| Action | Params | Description |
|--------|--------|-------------|
| `openFile` | `{"path": "README.md"}` | Open file (workspace-relative) |
| `openDataFile` | `{"path": "data.csv"}` | Open data file in Data Explorer |
| `newNotebook` | `{"codeCells?": 1, "markdownCells?": 0, "language?": "Python", "clearCells?": true}` | Create notebook; pass `null` for language to skip kernel |
| `runCodeInEditor` | `{"code": "x <- 42", "language?": "r"}` | Write code to temp file and execute via Cmd+Enter |
| `createFile` | `{"filename": "test.qmd", "content": "..."}` | Create file with content and open it. Prefer over qa-example-content. |
| `contextMenu` | `{"selector": ".el", "menuItem": "Pin Row"}` | Right-click and select from context menu |

**Raw Playwright actions** (`type: "action"`, for recovery/debugging):

| Action | Params | Description |
|--------|--------|-------------|
| `snapshot` | `{"maxLength?": 8000}` | Get accessibility tree |
| `clickText` | `{"text": "OK", "exact?": false}` | Click by visible text |
| `clickRole` | `{"role": "button", "name": "OK"}` | Click by accessible role |
| `press` | `{"key": "Escape"}` | Press keyboard key |
| `type` | `{"text": "hello", "delay?": 0}` | Type text into focused element |
| `takeScreenshot` | `{"name?": "test"}` | Save screenshot to /tmp/ |
| `waitForText` | `{"text": "Ready"}` | Wait for text |

## Scoping for side-by-side notebooks

Add `"scope": 0` or `"scope": 1` to scope locators to a specific editor group.

## When to assert

Add verification after an action when:
1. The target is ambiguous (e.g., two notebooks open)
2. A later step depends on the result
3. Shared state changed

Do NOT assert after every action -- POM methods have built-in waits.

## Explore Mode

If `/run-plan` fails twice and you need interactive diagnosis, see `references/runner-api-explore.md`.
