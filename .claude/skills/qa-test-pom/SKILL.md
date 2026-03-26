---
name: qa-test-pom
description: AI-driven hybrid QA testing for Positron -- POM actions for reliability, raw Playwright for adaptability
allowed-tools: ["Bash", "Read", "WebFetch"]
user-invocable: true
---

# QA Test -- Hybrid (POM + Raw Playwright)

Performs on-demand QA testing by driving Positron through test scenarios using the explore runner. Combines **POM actions** (reliable, battle-tested) with **raw Playwright actions** (flexible, adaptive) in a single server. Accepts a natural-language description or a GitHub issue number.

## Input Formats

```
/qa-test-pom "Verify that the Variables pane updates after running x = 42 in the Python console"
/qa-test-pom #12345
/qa-test-pom --quick #12345
```

## Workflow

### Step 1: Parse Input and Plan Test Steps

**If free-text description:**
Parse into 3-8 concrete, ordered test steps. Prefer POM actions for structured steps; use raw actions for exploration or recovery.

**If issue number with `--quick`:**
1. Fetch the issue: `gh issue view <number> --repo posit-dev/positron --json title,body,labels`
2. Parse the issue body to identify expected behavior
3. Plan test steps using the action catalog

**If issue number (default):**
1. Run the `positron-qa-verify` skill to generate a verification guide
2. Parse the guide into executable steps

### Step 2: Start the Explore Runner

Launch the Playwright test in the background:
```bash
cd /Users/marieidleman/Develop/positron
rm -f /tmp/explore-runner-port
npx playwright test test/e2e/tests/explore/explore.test.ts --project e2e-electron 2>&1 &
```

Wait for the runner to be ready by polling the port file:
```bash
for i in $(seq 1 60); do
  if [ -f /tmp/explore-runner-port ]; then
    PORT=$(cat /tmp/explore-runner-port)
    if curl -s "http://localhost:$PORT/health" | grep -q ok; then
      echo "Runner ready on port $PORT"
      break
    fi
  fi
  sleep 2
done
```

This launches Positron as a real Electron app. It takes ~30-60 seconds to start.

### Step 3: Execute Test Steps

For each test step, send a POST request to the runner:

```bash
PORT=$(cat /tmp/explore-runner-port)
curl -s -X POST "http://localhost:$PORT/action" \
  -H 'Content-Type: application/json' \
  -d '{"action": "ACTION_NAME", "params": {PARAMS}}'
```

Every response is JSON with this structure:
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

Use the `state` object to decide if the step passed and what to do next.

### Action Catalog

Actions are organized in three tiers. **Use the highest tier that fits your need.**

#### Tier 1: POM Actions -- Sessions

| Action | Params | Description |
|--------|--------|-------------|
| `startSession` | `{"language": "python"}` | Start a Python or R session |
| `restartSession` | `{"sessionId?": "..."}` | Restart current or specific session |
| `deleteAllSessions` | `{}` | Delete all sessions |
| `selectSession` | `{"session": "name-or-id"}` | Select a session |
| `getSessionCount` | `{}` | Get number of sessions |
| `expectAllSessionsReady` | `{"timeout?": 30000}` | Verify all sessions are idle/disconnected |

#### Tier 1: POM Actions -- Console

| Action | Params | Description |
|--------|--------|-------------|
| `executeCode` | `{"language": "Python", "code": "x = 42"}` | Execute code (waits for completion) |
| `expectConsoleOutput` | `{"text": "hello"}` | Wait for text to appear in console output |
| `pasteToConsole` | `{"code": "...", "execute?": true}` | Paste code (useful for multi-line) |
| `typeToConsole` | `{"text": "x", "pressEnter?": true}` | Type into console input |
| `waitForConsoleReady` | `{"prompt?": ">>>"}` | Wait for console prompt |
| `consoleSendEnter` | `{}` | Send Enter key |
| `clearConsoleInput` | `{}` | Clear console input |
| `maximizeConsole` | `{}` | Maximize console panel |
| `interruptExecution` | `{}` | Interrupt running code |
| `expectConsoleError` | `{"error": "NameError"}` | Verify console shows error |
| `focusConsole` | `{}` | Focus the console |

#### Tier 1: POM Actions -- Variables

| Action | Params | Description |
|--------|--------|-------------|
| `expectVariable` | `{"name": "x", "value?": "42"}` | Assert variable exists (optionally with value) |
| `expectVariableNotExist` | `{"name": "x"}` | Assert variable does not exist |
| `openInDataExplorer` | `{"name": "df"}` | Double-click variable to open in Data Explorer |
| `toggleVariable` | `{"name": "obj", "action": "expand"}` | Expand or collapse a variable |
| `deleteAllVariables` | `{}` | Delete all variables |
| `clickDatabaseIcon` | `{"name": "conn"}` | Click database icon for a variable |

#### Tier 1: POM Actions -- Data Explorer

| Action | Params | Description |
|--------|--------|-------------|
| `sortColumn` | `{"columnIndex": 1, "direction": "Sort Ascending"}` | Sort a column (1-based index) |
| `expectCellValue` | `{"rowIndex": 0, "colIndex": 0, "value": "Alice"}` | Verify cell content |
| `expectRowCount` | `{"count": 100}` | Verify row count |
| `expectColumnHeaders` | `{"headers": ["name", "age"]}` | Verify column headers |
| `expectRowOrder` | `{"expectedOrder": [1, 2, 0]}` | Verify row order after sorting |
| `addDataFilter` | `{"columnName": "age", "condition": ">=", "value": "30"}` | Add a filter |
| `clearAllFilters` | `{}` | Clear all filters and sorting |
| `maximizeDataExplorer` | `{"showSummaryPanel?": true}` | Maximize the Data Explorer |
| `expectDataExplorerStatus` | `{"text": "3 rows"}` | Verify status bar text |
| `clickDataCell` | `{"rowPosition": 0, "columnPosition": 0}` | Click a cell |
| `getDataExplorerData` | `{}` | Get all grid data as JSON |
| `getColumnHeaders` | `{}` | Get column header names |

#### Tier 1: POM Actions -- Plots

| Action | Params | Description |
|--------|--------|-------------|
| `waitForPlot` | `{}` | Wait for a plot to appear |
| `waitForStaticPlot` | `{}` | Wait for a static plot |
| `expectPlotCount` | `{"count": 3}` | Verify plot thumbnail count |
| `clearPlots` | `{}` | Clear all plots |
| `waitForNoPlots` | `{}` | Wait for all plots to disappear |
| `savePlot` | `{"name": "my-plot", "format": "PNG"}` | Save plot from Plots pane |
| `setPlotZoom` | `{"zoom": "100%"}` | Set plot zoom level |
| `openPlotIn` | `{"location": "Editor"}` | Open plot in editor/window |
| `waitForWebviewPlot` | `{"selector?": ".plot-instance"}` | Wait for webview plot (plotly, etc.) |

#### Tier 1: POM Actions -- Files & Editor

| Action | Params | Description |
|--------|--------|-------------|
| `runCommand` | `{"command": "workbench.action.togglePanel"}` | Run any VS Code command |
| `openFile` | `{"path": "README.md"}` | Open file (workspace-relative or absolute path) |
| `openDataFile` | `{"path": "data-files/flights.csv"}` | Open data file in Data Explorer (workspace-relative or absolute) |
| `editorType` | `{"text": "hello", "pressEnter?": true}` | Type in the editor |
| `editorSelectAndType` | `{"filename": "file.py", "text": "..."}` | Select tab and type |
| `editorPressPlay` | `{}` | Click the run/play button |
| `expectEditorContent` | `{"filename": "file.py", "text": "def"}` | Verify editor contains text |
| `getEditorLine` | `{"filename": "file.py", "line": 1}` | Get a line from the editor |
| `clickTab` | `{"name": "file.py"}` | Click an editor tab |
| `expectTab` | `{"name": "file.py", "isVisible?": true}` | Verify tab exists |
| `waitForActiveTab` | `{"filename": "file.py"}` | Wait for tab to be active |
| `newUntitledFile` | `{}` | Create new untitled file |
| `saveFile` | `{}` | Save current file |
| `saveFileAs` | `{"path": "newfile.txt"}` | Save as (workspace-relative or absolute) |

#### Tier 1: POM Actions -- Settings

| Action | Params | Description |
|--------|--------|-------------|
| `setSetting` | `{"settings": {"key": "value"}, "reload?": true}` | Set IDE settings |
| `clearSettings` | `{}` | Clear all custom settings (restore defaults) |
| `removeSettings` | `{"keys": ["setting.key"]}` | Remove specific settings by key |

#### Tier 1: POM Actions -- Hot Keys

| Action | Params | Description |
|--------|--------|-------------|
| `copy` | `{}` | Copy to clipboard |
| `cut` | `{}` | Cut to clipboard |
| `paste` | `{}` | Paste from clipboard |
| `undo` | `{}` | Undo last action |
| `redo` | `{}` | Redo last action |
| `selectAll` | `{}` | Select all content |
| `find` | `{}` | Open find dialog |
| `closeAllEditors` | `{}` | Close all editors via hotkey |
| `closeTab` | `{}` | Close current tab |
| `toggleBottomPanel` | `{}` | Toggle bottom panel |
| `minimizeBottomPanel` | `{}` | Minimize bottom panel |
| `restoreBottomPanel` | `{}` | Restore bottom panel |
| `showSecondarySidebar` | `{}` | Show secondary sidebar |
| `closeSecondarySidebar` | `{}` | Close secondary sidebar |
| `closePrimarySidebar` | `{}` | Close primary sidebar |
| `focusConsoleHotKey` | `{}` | Focus console via hotkey |
| `reloadWindow` | `{"waitForReady?": true}` | Reload window |
| `executeNotebookCell` | `{}` | Execute notebook cell via hotkey |
| `runFileInConsole` | `{}` | Run file in console |
| `runLineOfCode` | `{}` | Run current line in console |
| `sendInterrupt` | `{}` | Send interrupt to console |
| `formatDocument` | `{}` | Format document |
| `clearAllBreakpoints` | `{}` | Clear all breakpoints |
| `showDataExplorerSummaryPanel` | `{}` | Show DE summary panel |
| `hideDataExplorerSummaryPanel` | `{}` | Hide DE summary panel |
| `killAllTerminals` | `{}` | Kill all terminals |

#### Tier 1: POM Actions -- Notebooks

| Action | Params | Description |
|--------|--------|-------------|
| `newNotebook` | `{"codeCells?": 1, "markdownCells?": 0}` | Create Positron notebook (auto-enables + reloads) |
| `addCodeToCell` | `{"cellIndex": 0, "code": "...", "run?": true}` | Add code to notebook cell |
| `addCell` | `{"type": "code"}` | Add notebook cell |
| `expectCellOutput` | `{"cellIndex": 0, "expectedLines": ["hello"]}` | Verify cell output |
| `expectCellCount` | `{"count": 3}` | Verify notebook cell count |
| `selectKernel` | `{"kernelGroup": "Python"}` | Select notebook kernel |

#### Tier 2: Raw Playwright Actions (flexible, adaptive)

| Action | Params | Description |
|--------|--------|-------------|
| `snapshot` | `{"maxLength?": 8000}` | Get accessibility tree of current page |
| `clickText` | `{"text": "Dismiss", "exact?": false}` | Click by visible text |
| `clickRole` | `{"role": "button", "name": "OK"}` | Click by accessible role + name |
| `clickSelector` | `{"selector": ".cls", "force?": false, "dblclick?": false}` | Click by CSS selector |
| `fill` | `{"text": "hello", "role?": "textbox", "name?": "Search"}` | Fill input |
| `press` | `{"key": "Escape"}` | Press keyboard key/shortcut |
| `waitForText` | `{"text": "Ready"}` | Wait for text on page |
| `waitForSelector` | `{"selector": ".loaded", "state?": "visible"}` | Wait for CSS selector |

#### Tier 3: Escape Hatches

| Action | Params | Description |
|--------|--------|-------------|
| `runCommand` | `{"command": "..."}` | Run any VS Code/Positron command |
| `takeScreenshot` | `{"name?": "my-test"}` | Save screenshot to /tmp/ |

### Hybrid Strategy

1. **Is there a POM action for this?** Use it. POM actions have built-in waits, retries, and are battle-tested.
2. **POM action failed?** Call `snapshot` to see the full UI. Look for unexpected dialogs, loading states, or errors.
3. **Need to interact with something unexpected?** Use `clickText`, `clickRole`, `press`, or `fill`.
4. **Retry the POM action** after clearing the obstacle.
5. **No POM action exists?** Use `snapshot` to find the element, then raw actions to interact.

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
- `executeCode` and `startSession` wait for completion -- no manual delays needed.
- `snapshot` returns the accessibility tree -- search for roles, names, states.
- Raw actions default to 5s timeout, POM actions to 10s. Override with `timeout` param.
- Data Explorer `columnIndex` is 1-based. `rowIndex`/`colIndex` for cells are 0-based.
