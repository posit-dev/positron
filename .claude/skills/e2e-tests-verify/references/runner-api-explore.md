# Explore Mode (Fallback)

Use when `/run-plan` fails twice and you need to diagnose interactively.
This is NOT the primary workflow -- use `/run-plan` first, always.

## POM calls (`POST /pom`)

Call any POM method directly:
```bash
PORT=$(cat /tmp/explore-runner-port-NNNNN) && curl -s -X POST "http://localhost:${PORT}/pom" \
  -H 'Content-Type: application/json' \
  -d '{"pom": "sessions", "method": "start", "args": ["python"], "title": "Start Python session"}'
```

**Request fields:**
- `pom` (required): Workbench property name. Supports dotted paths: `"dataExplorer.grid"`.
- `method` (required): Method name on the POM class
- `args` (optional): Positional arguments array (default `[]`)
- `scope` (optional): Editor group index for side-by-side scoping
- `title` (optional): Human-readable label for Playwright report

## Custom + Raw actions (`POST /action`)

Same action catalog as `/run-plan` steps, but as individual calls:
```bash
PORT=$(cat /tmp/explore-runner-port-NNNNN) && curl -s -X POST "http://localhost:${PORT}/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "snapshot", "params": {"maxLength": 8000}, "title": "Diagnose current state"}'
```

## Batch execution (`POST /batch`)

Send multiple steps in one request:
```bash
PORT=$(cat /tmp/explore-runner-port-NNNNN) && curl -s -X POST "http://localhost:${PORT}/batch" \
  -H 'Content-Type: application/json' \
  -d '{"title": "Debug step", "steps": [
    {"type": "action", "action": "snapshot", "params": {"maxLength": 8000}, "title": "Snapshot UI"},
    {"type": "pom", "pom": "console", "method": "waitForReady", "args": [">>>"], "title": "Wait for console"}
  ]}'
```
