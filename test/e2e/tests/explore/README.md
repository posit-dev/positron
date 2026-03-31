# Explore Runner -- AI-Driven QA Testing

An HTTP server that runs inside a Playwright test, exposing Positron's Page Object
Models (POMs) as simple REST actions. Claude Code plans test steps, sends them as
`curl` requests, reads the JSON responses, and decides what to do next.

## Architecture

```
Claude Code (AI)                     Explore Runner (Playwright test)
  |                                    |
  |  npx playwright test               |
  |  explore.test.ts (background)      |
  |  --------------------------------> |  launches Electron + HTTP server
  |                                    |  writes port to /tmp/explore-runner-port
  |  POST /action                      |
  |  {"action":"startSession",         |
  |   "params":{"language":"python"}}  |
  |  --------------------------------> |  calls POM: sessions.start("python")
  |                                    |  gathers compact state
  |  <-------------------------------- |  {"success":true, "state":{...}}
  |                                    |
  |  (AI decides next action)          |
  |  ...repeat...                      |
  |                                    |
  |  POST /done                        |
  |  --------------------------------> |  cleanup + exit
```

## Files

| File | Purpose |
|------|---------|
| `explore.test.ts` | Playwright test entry point. Uses the `app` fixture to get a full Application instance, starts the HTTP server, waits for `/done` or 10-minute timeout. |
| `server.ts` | HTTP server (~85 lines, Node built-in `http`). Three endpoints: `POST /action`, `POST /done`, `GET /health`. Writes port to `/tmp/explore-runner-port`. |
| `action-catalog.ts` | 102 action handlers mapping action names to POM calls. Organized in tiers: POM actions (reliable), raw Playwright actions (flexible), escape hatches. |
| `action-executor.ts` | Dispatcher. Looks up action in catalog, runs it, times it, catches errors, gathers state. |
| `observer.ts` | Compact state probe. After every action, queries active editor, console lines, variable count, plot visibility. Each probe has a 2-second timeout and fails silently. |
| `types.ts` | TypeScript interfaces: `ActionRequest`, `ActionResult`, `AppState`. |

## How It Works

1. **The runner is a real Playwright test.** It gets the full `Application` fixture with all
   44 POMs (console, sessions, variables, plots, data explorer, etc.), Electron launch
   configuration, user data directory, and automatic Playwright tracing.

2. **Actions wrap existing POMs.** `startSession` calls `app.workbench.sessions.start()`.
   `executeCode` calls `app.workbench.console.executeCode()`. No duplication of test
   infrastructure.

3. **State is compact.** After every action, the observer probes 5 lightweight signals
   (~50 bytes of JSON). This replaces the full accessibility tree dump that made earlier
   approaches token-heavy and slow.

4. **Raw Playwright actions fill gaps.** When a POM action fails or no POM exists,
   `snapshot` returns the accessibility tree for diagnosis, and `clickText`/`clickRole`/
   `press`/`fill` allow direct interaction.

## Action Tiers

- **Tier 1: POM Actions** -- Battle-tested, built-in waits and retries. Use these first.
  Sessions, console, variables, data explorer, plots, files/editor, settings, hotkeys, notebooks.

- **Tier 2: Raw Playwright** -- `snapshot`, `clickText`, `clickRole`, `clickSelector`,
  `fill`, `press`, `waitForText`, `waitForSelector`. For exploration and recovery.

- **Tier 3: Escape Hatches** -- `runCommand` (any VS Code command), `takeScreenshot`.

## Usage

### Manual (for development/debugging)

```bash
# Terminal 1: Start the runner
npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-electron

# Terminal 2: Wait for port, then send actions
PORT=$(cat /tmp/explore-runner-port)

curl -s -X POST "http://localhost:$PORT/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "startSession", "params": {"language": "python"}}'

curl -s -X POST "http://localhost:$PORT/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "executeCode", "params": {"language": "Python", "code": "x = 42"}}'

curl -s -X POST "http://localhost:$PORT/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "expectVariable", "params": {"name": "x", "value": "42"}}'

# When done
curl -s -X POST "http://localhost:$PORT/done"
```

### Via Claude Code Skill

```
/qa-test-pom "Start a Python session, run x = 42, verify x appears in Variables pane"
/qa-test-pom #12523
```

The skill (`.claude/skills/qa-test-pom/SKILL.md`) documents the full action catalog
and the hybrid strategy for combining POM and raw Playwright actions.

## CI Safety

The explore tests are excluded from all CI projects via `playwright.config.ts`:

```typescript
const baseIgnore = [
  // ...
  '**/explore/**',
];
```

They never run in CI. They are on-demand, session-based, best-effort QA tools.

## Response Format

Every action returns:

```json
{
  "success": true,
  "result": "Started python session",
  "state": {
    "activeEditor": "Untitled-1",
    "consoleLinesCount": 5,
    "lastConsoleOutput": ">>>",
    "variableCount": 0,
    "plotVisible": false
  },
  "duration": 1234
}
```

The `state` object is the key feedback loop -- the AI reads it to decide if a step
passed and what to do next.

## Claude Code Permissions

The skill sends multiple `Bash` and `curl` commands per test run. To avoid being
prompted for each one, add these permission rules to your Claude Code settings.

**For local use**, add to `.claude/settings.local.json` (gitignored):

```json
{
  "permissions": {
    "allow": [
      "Bash(rm -f /tmp/explore-runner-port:*)",
      "Bash(EXPLORE_TITLE=:*)",
      "Bash(for i in $(seq 1 60):*)",
      "Bash(for i in 1:*)",
      "Bash(curl -s -X POST \"http://localhost:*)",
      "Bash(curl -s \"http://localhost:*)",
      "Bash(curl:*)",
      "Bash(gh issue view:*)",
      "Bash(npx playwright:*)",
      "Bash(kill:*)",
      "Bash(sleep:*)"
    ]
  }
}
```

**What each rule covers:**

| Rule | Purpose |
|------|---------|
| `rm -f /tmp/explore-runner-port:*` | Cleanup before starting runner |
| `EXPLORE_TITLE=:*` | Runner startup with dynamic test title |
| `for i in $(seq 1 60):*` | Polling loop waiting for runner to be ready |
| `for i in 1:*` | Batched action loops |
| `curl -s -X POST "http://localhost:*` | POST action/describe/done calls |
| `curl -s "http://localhost:*` | GET health checks |
| `curl:*` | General curl (fallback) |
| `gh issue view:*` | Fetching GitHub issues for test planning |
| `npx playwright:*` | Playwright commands |
| `kill:*` | Cleanup of background processes |
| `sleep:*` | Wait between actions |

These rules use prefix matching (`:*` suffix), so they cover any command that
starts with the given prefix. They are scoped to the commands the skill actually
uses and do not grant broad shell access.

**Note:** Rules with `$(...)` subshell syntax (e.g., `PORT=$(cat ...)`) may not
match correctly in Claude Code's permission system. Use direct `curl` patterns
instead.

## Design Decisions

- **HTTP, not MCP**: 85 lines of Node built-in `http`. No protocol compatibility issues,
  no token-heavy snapshots, trivially callable from `curl`.
- **Playwright test, not standalone script**: Reuses the full test fixture system. No
  duplication of launch config, settings, or tracing.
- **102 curated actions, not raw POM exposure**: AI works better with a finite, documented
  verb set. `runCommand` covers edge cases.
- **Compact state, not accessibility tree**: 5 probes, ~50 bytes, 2-second timeout each.
  The full accessibility tree is available on demand via `snapshot`.
