# QA Test v2: Codegen-Driven AI QA with Single-Launch Architecture

## Problem

The current `/qa-test` explore runner works but is too slow. Three pain points:

1. **Round-trip overhead (primary):** Each test step requires a Bash tool call -> curl -> HTTP -> POM -> response -> parse cycle. A 5-step test costs ~8-15 tool calls and ~20 seconds of overhead beyond POM execution time.
2. **Parameter guessing:** The catalog shows method names but not TypeScript union types. The AI guesses `"busy"` when the valid values are `"active" | "idle"`, causing retries that multiply the round-trip cost.
3. **Thin observer:** 5 fixed probes (~50 bytes) don't give the AI enough signal to diagnose failures. Falls back to `snapshot` (token-heavy accessibility tree dump).

### Target

- Under 30 seconds execution time (excluding app launch)
- 3-5 tool calls for happy path
- Handles deterministic tests AND exploratory scenarios
- Leverages existing 50+ POM classes

## Architecture

Two execution modes, one skill entry point, single app launch:

```
/qa-test "start Python, run x=42, verify variable"
  |
  v
1. Launch explore runner (once, 30-60s)     <-- only app launch
  |
  v
2. AI reads POM reference, plans test
  |
  v
3. AI sends entire test as one POST /run-plan call
  |
  +-- PASS --> report results, POST /done
  |
  +-- FAIL --> AI reads error + enriched state
               +-- Fixable --> state reset + corrected /run-plan (NO relaunch)
               +-- Needs exploration --> switch to single-step mode (NO relaunch)
               +-- Infra issue --> report to user
```

### Mode Selection

- **Default (deterministic):** Issue numbers, free-text descriptions with concrete steps -> `/run-plan`
- **Explore mode:** Open-ended prompts, `--explore` flag, or fallback from failed deterministic runs -> single-step HTTP calls (current behavior, improved)

The app launches exactly once. Retries, exploration, and recovery all reuse the running instance.

## Components

### 1. POM Reference File

**Purpose:** Eliminate parameter guessing (pain point #2).

**Location:** `test/e2e/tests/qa-generated/pom-reference.md` (gitignored, regenerated on demand)

**Format:** Compact, AI-optimized markdown with full TypeScript signatures:

```markdown
## sessions (test/e2e/pages/sessions.ts)
- start(language: 'python' | 'r', options?: { waitForReady?: boolean })
- select(sessionIdOrName: string, waitForSessionIdle?: boolean)
- expectStatusToBe(sessionIdOrName: string, expectedStatus: 'active' | 'starting' | 'idle' | 'disconnected' | 'exited', options?: { timeout?: number })
- expectAllReady()
- deleteAll()

## console (test/e2e/pages/console.ts)
- executeCode(languageName: 'Python' | 'R', code: string, options?: { timeout?: number })
...
```

**Generation:** A script (`scripts/generate-pom-reference.ts`) that:

1. Reads the Workbench class to find all POM properties and their types
2. For each POM, parses the source `.ts` file to extract public method signatures with full TypeScript type annotations (including union types, optional params, defaults)
3. Enumerates getter-based sub-objects (e.g., `dataExplorer.grid`, `dataExplorer.summaryPanel`)
4. Outputs compact markdown

The existing `validate-catalog.ts` already parses workbench props and POM sources -- this script extends that logic to extract type annotations.

**Runtime:** Under 2 seconds (file parsing only, no Electron). Can run at the start of each `/qa-test` invocation or check a timestamp to skip if recent.

### 2. `/run-plan` Endpoint

**Purpose:** Execute an entire test in one HTTP call (pain point #1).

**Request:**

```json
POST /run-plan
{
  "title": "QA #12345: Variable appears after execution",
  "resetBefore": false,
  "stepTimeout": 10000,
  "steps": [
    {
      "type": "pom",
      "pom": "sessions",
      "method": "start",
      "args": ["python"],
      "timeout": 20000,
      "title": "Start Python session"
    },
    {
      "type": "pom",
      "pom": "console",
      "method": "executeCode",
      "args": ["Python", "x = 42"],
      "title": "Execute x = 42"
    },
    {
      "type": "pom",
      "pom": "variables",
      "method": "expectVariableToBe",
      "args": ["x", "42"],
      "timeout": 5000,
      "title": "Verify x in Variables pane"
    }
  ]
}
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string (required) | Label for the test group in the Playwright report |
| `steps` | array (required) | Ordered steps -- same schema as current `/batch` steps |
| `resetBefore` | boolean (default false) | Run state reset before executing steps (set true on retries) |
| `stepTimeout` | number (default 10000) | Default timeout in ms for all steps |
| Per-step `timeout` | number (optional) | Override timeout for a specific step |

**Response (success):**

```json
{
  "passed": 3,
  "failed": 0,
  "steps": [
    {"title": "Start Python session", "success": true, "duration": 2100},
    {"title": "Execute x = 42", "success": true, "duration": 800},
    {"title": "Verify x in Variables pane", "success": true, "duration": 400}
  ],
  "totalDuration": 3300,
  "state": {
    "activeEditor": null,
    "consoleLinesCount": 12,
    "lastConsoleOutput": ">>> x = 42",
    "variableCount": 1,
    "variableNames": ["x"],
    "plotVisible": false,
    "sessionCount": 1,
    "activeSession": "Python: idle",
    "notifications": [],
    "openTabs": [],
    "focusedPanel": "console"
  }
}
```

**Response (failure at step 2 of 3):**

```json
{
  "passed": 1,
  "failed": 1,
  "steps": [
    {"title": "Start Python session", "success": true, "duration": 2100},
    {"title": "Execute x = 42", "success": false, "error": "Timeout 10000ms exceeded", "duration": 10023}
  ],
  "skipped": 1,
  "totalDuration": 12123,
  "state": {
    "activeEditor": null,
    "consoleLinesCount": 3,
    "lastConsoleOutput": ">>>",
    "variableCount": 0,
    "variableNames": [],
    "sessionCount": 1,
    "activeSession": "Python: idle",
    "notifications": ["Interpreter disconnected"],
    "openTabs": [],
    "focusedPanel": "console"
  }
}
```

**Execution model:** Same as current `/batch` -- sequential, fail-fast, each step wrapped in `test.step()` for report hierarchy. State observed once at the end (or at failure point).

**Timeouts:**

- `stepTimeout` default: 10000ms (faster feedback than current 15s expect timeout)
- Session start / code execution: override to 15000-20000ms (genuinely need longer)
- Assertions (`expect*`, `waitFor*`): 5000-10000ms (should be fast)
- Individual steps can override via per-step `timeout` field

### 3. State Reset

**Purpose:** Clean up stale state between retry attempts.

Runs automatically when `resetBefore: true` is set on a `/run-plan` call. Each step is best-effort with a 2-second timeout -- failures are logged but don't block the retry.

**Reset sequence:**

1. Dismiss blocking UI: press Escape 3 times (covers dialogs, quick input, context menus)
2. Close all editors: `workbench.action.closeAllEditors`
3. Clear notifications: `notifications.clearAll`
4. Delete all sessions: `sessions.deleteAll()`
5. Restore bottom panel: `workbench.action.togglePanel` (force show)
6. Focus editor area: `workbench.action.focusActiveEditorGroup`

**What reset does NOT cover:**

- Workspace files on disk (AI should clean up temp files explicitly)
- VS Code settings (if test changed settings, they persist)
- Extension state

**Response includes cleanup report:**

```json
{
  "resetActions": [
    "Dismissed overlays (3x Escape)",
    "Closed all editors",
    "Cleared notifications",
    "Deleted all sessions",
    "Restored bottom panel",
    "Focused editor area"
  ],
  "passed": 3,
  ...
}
```

### 4. Enriched Observer

**Purpose:** Give the AI enough signal to diagnose failures without falling back to `snapshot` (pain point #3).

**Current (5 probes, ~50 bytes):**

```json
{"activeEditor": "Untitled-1", "consoleLinesCount": 5, "lastConsoleOutput": ">>>", "variableCount": 0, "plotVisible": false}
```

**Proposed (~200 bytes):**

```json
{
  "activeEditor": "Untitled-1.ipynb",
  "consoleLinesCount": 12,
  "lastConsoleOutput": ">>> x = 42",
  "variableCount": 1,
  "variableNames": ["x"],
  "plotVisible": false,
  "sessionCount": 1,
  "activeSession": "Python: idle",
  "notifications": ["Something went wrong"],
  "openTabs": ["Untitled-1.ipynb", "README.md"],
  "focusedPanel": "console"
}
```

**New probes:**

| Probe | Why | Timeout |
|-------|-----|---------|
| `variableNames` | Debug "variable didn't appear" without a separate call. Up to 20 names. | 500ms |
| `activeSession` | Session name + status. Catches "session crashed" immediately. | 500ms |
| `notifications` | Visible toasts often explain why something failed. | 500ms |
| `openTabs` | Which files/editors are open. Catches "opened wrong file". | 500ms |
| `focusedPanel` | Which pane has focus (console, terminal, editor, variables). | 500ms |
| `sessionCount` | How many sessions are running. | 500ms |

Each probe has a 500ms timeout and fails silently. Total observer overhead stays under 1 second.

### 5. Updated Skill Workflow

**Entry point:**

```
/qa-test "Start Python, run x=42, verify variable"
/qa-test #12345
/qa-test --quick #12345
/qa-test --explore "poke around Data Explorer filters"
/qa-test --save #12345
/qa-test --build "Verify plots render correctly"
/qa-test --browser firefox #11593
```

**Happy path (4 tool calls):**

| # | Tool | Action |
|---|------|--------|
| 1 | Bash | Launch explore runner in background, poll for ready |
| 2 | Read | Read `pom-reference.md` for method signatures |
| 3 | Bash | `POST /run-plan` with entire test (one curl call) |
| 4 | Bash | `POST /done` (cleanup) |

**Failure path (6-7 tool calls):**

| # | Tool | Action |
|---|------|--------|
| 1 | Bash | Launch explore runner, poll for ready |
| 2 | Read | Read `pom-reference.md` |
| 3 | Bash | `POST /run-plan` -- FAILS |
| 4 | Bash | `POST /run-plan` with `resetBefore: true` and corrected steps |
| 5 | Bash | (optional) Single-step explore if retry also fails |
| 6 | Bash | `POST /done` |

**Retry budget:** 2 `/run-plan` attempts maximum before switching to explore mode or reporting failure.

**Mode selection logic:**

| Input | Mode |
|-------|------|
| Issue number | Deterministic (`/run-plan`) |
| Free-text with concrete steps | Deterministic (`/run-plan`) |
| `--explore` flag | Explore (single-step) |
| Vague/open-ended prompt | Explore (single-step) |
| Failed deterministic (after 2 retries) | Explore (single-step) |

**`--save` flag:** When present and the test passes, the AI also writes a standalone `.test.ts` file to `test/e2e/tests/qa-generated/` that can be run independently. This "graduates" a QA test into a reusable e2e test.

**Output format:**

```
QA #12345: Variable appears after execution
Target: Local dev (Electron)

Step 1: Start Python session .................. PASS (2.1s)
Step 2: Execute x = 42 in console ............. PASS (0.8s)
Step 3: Verify x in Variables pane ............ PASS (0.4s)

Result: 3/3 passed (3.3s)

Rough edges noticed during testing:
- (none this run)
```

## File Changes Summary

### New files

| File | Purpose |
|------|---------|
| `scripts/generate-pom-reference.ts` | Generates POM reference from source files |
| `test/e2e/tests/qa-generated/_qa.setup.ts` | Stable re-export of `_test.setup` for saved tests |
| `test/e2e/tests/qa-generated/pom-reference.md` | Generated POM reference (gitignored) |

### Modified files

| File | Changes |
|------|---------|
| `test/e2e/tests/explore/server.ts` | Add `/run-plan` route, wire up state reset |
| `test/e2e/tests/explore/action-executor.ts` | Add `executeRunPlan()` with per-step timeouts |
| `test/e2e/tests/explore/observer.ts` | Add 6 new probes (variableNames, activeSession, notifications, openTabs, focusedPanel, sessionCount) |
| `test/e2e/tests/explore/types.ts` | Add `RunPlanRequest`, `RunPlanResult` interfaces, expand `AppState` |
| `.claude/skills/qa-test/SKILL.md` | Rewrite workflow for run-plan-first approach |
| `.gitignore` | Add `test/e2e/tests/qa-generated/` |
| `test/e2e/tests/explore/DESIGN.md` | Update with v2 architecture |
| `test/e2e/tests/explore/README.md` | Add `/run-plan` endpoint documentation |

### Unchanged

| File | Why |
|------|-----|
| `test/e2e/tests/explore/explore.test.ts` | Entry point stays the same |
| `test/e2e/tests/explore/action-catalog.ts` | Custom/raw actions unchanged |
| `test/e2e/tests/explore/validate-catalog.ts` | Existing validation unchanged |
| All POM files (`test/e2e/pages/*.ts`) | No POM changes needed |

## What This Does NOT Change

- **Existing e2e tests:** Zero impact. The explore runner is excluded from CI.
- **POM classes:** No modifications. The reference file reads them; it doesn't change them.
- **The explore runner's existing endpoints:** `/action`, `/pom`, `/batch`, `/health`, `/done` all stay. `/run-plan` is additive.
- **CI pipelines:** No changes. `qa-generated/` is gitignored and CI-excluded.

## Open Questions

- **POM reference staleness:** Regenerate on every `/qa-test` run, or check file age and skip if recent (e.g., under 1 hour)?
- **Saved test quality:** When `--save` writes a `.test.ts`, should it include comments explaining what each step tests? Or keep it minimal like hand-written e2e tests?
- **Observer tuning:** The 6 new probes are a starting point. May need adjustment after real-world usage.
