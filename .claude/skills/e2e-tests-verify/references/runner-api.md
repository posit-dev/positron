# Runner API Reference

## /run-plan Request

```bash
PORT=$(cat /tmp/explore-runner-port) && curl -s -X POST "http://localhost:${PORT}/run-plan" \
  -H 'Content-Type: application/json' \
  -d '{"title": "PR 456: Variable test", "stepTimeout": 5000, "steps": [
    {"type": "pom", "pom": "sessions", "method": "start", "args": ["python"], "timeout": 30000, "title": "Start Python"},
    {"type": "pom", "pom": "console", "method": "executeCode", "args": ["Python", "x = 42"], "timeout": 15000, "title": "Execute x = 42"},
    {"type": "pom", "pom": "variables", "method": "expectVariableToBe", "args": ["x", "42"], "title": "Verify x"}
  ]}'
```

**Request:** `title` (required), `steps` (required), `stepTimeout` (default 5000ms), `resetBefore` (true on retries).
**Step:** `type` ("pom" or "action"), then `pom`+`method`+`args` or `action`+`params`. Optional: `title`, `timeout`, `scope` (editor group index for side-by-side).
**Multiline code:** Use heredoc: `cat <<'PAYLOAD' | curl ... -d @-`. In JSON, `\n` is a literal newline -- no special bash quoting.
**Do NOT use `$'...'` bash syntax** -- triggers permission prompts.

## Timeout Tiers

| Tier | Timeout | Operations |
|------|---------|------------|
| **Fast** (default) | 5s | `expect*`, `waitFor*`, visibility checks, clicks, `snapshot`, `takeScreenshot` |
| **Medium** | 15-20s | `executeCode`, `runAllCells`, `createFile`, `openFile`, output waits |
| **Slow** | 30-40s | `sessions.start`, kernel connection, settings with reload |

Set `stepTimeout: 5000`. Override per-step only for Medium/Slow. Never above 20s unless session/kernel. If it times out at 15s, diagnose -- don't double the timeout.

## Response

Returns `passed`, `failed`, `steps` array (each with `title`, `success`, `duration`, `error`), `totalDuration`, and `state` object with: `variableNames`, `activeSession`, `notifications`, `openTabs`, `focusedPanel`.

## Actions

**Custom** (`type: "action"`):

| Action | Params | Description |
|--------|--------|-------------|
| `openFile` | `{"path": "README.md"}` | Open file (workspace-relative) |
| `openDataFile` | `{"path": "data.csv"}` | Open in Data Explorer |
| `newNotebook` | `{"codeCells?": 1, "language?": "Python", "clearCells?": true}` | Create notebook; `null` language skips kernel |
| `runCodeInEditor` | `{"code": "x <- 42", "language?": "r"}` | Write temp file + execute via Cmd+Enter |
| `createFile` | `{"filename": "test.qmd", "content": "..."}` | Create + open file. For .qmd: kernel won't connect until you runCurrentCell() -- don't expectKernelIdle right after. |
| `contextMenu` | `{"selector": ".el", "menuItem": "Pin Row"}` | Right-click context menu |

**Raw Playwright** (`type: "action"`, recovery/debugging only):

| Action | Params |
|--------|--------|
| `snapshot` | `{"maxLength?": 8000}` |
| `clickText` | `{"text": "OK", "exact?": false}` |
| `clickRole` | `{"role": "button", "name": "OK"}` |
| `press` | `{"key": "Escape"}` |
| `type` | `{"text": "hello", "delay?": 0}` |
| `takeScreenshot` | `{"name?": "test"}` |
| `waitForText` | `{"text": "Ready"}` |

## When to assert

Only after ambiguous targets, result dependencies, or shared state changes. POM methods have built-in waits -- don't assert after every step.

## Explore Mode

If `/run-plan` fails twice, see `references/runner-api-explore.md`.
