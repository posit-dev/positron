# AI Test Runner Backlog

Tracked issues, missing capabilities, and improvement ideas for the explore runner.

## Action Catalog

- [ ] **`addCodeToCell` does not convert cell type on the default cell.**
  The `type: "markdown"` option only works on cells that are already markdown.
  The first cell in a new notebook defaults to code, so passing `{type: "markdown"}`
  silently leaves it as a code cell. Workaround: call `performCellAction("changeToMarkdown")`
  first, or create the notebook with `markdownCells: 1`. Consider having `addCodeToCell`
  auto-convert the cell type when `type` differs from the current cell kind.

## POM Gaps

- [x] **Ghost cell POM methods missing.**
  RESOLVED: Added `expectGhostCellNotVisible()`, `dismissGhostCellSuggestion()`,
  `clickGhostCellInfoButton()`, and `expectGhostCellInfoDialogContent(expectations)`
  to `notebooksPositron.ts`. `expectGhostCellVisible()` and `acceptGhostCellSuggestion()`
  already existed.

- [x] **Ghost cell opt-in/enable flow not in POM.**
  RESOLVED: Added locators for the opt-in prompt (`.ghost-cell-opt-in`, button selectors)
  and methods `enableGhostCellSuggestions()`, `dismissGhostCellOptIn()`,
  `disableGhostCellOptIn()`, `expectGhostCellOptInVisible()`,
  `expectGhostCellOptInNotVisible()` to `notebooksPositron.ts`.

- [x] **`clickDatabaseIconForVariableRow` unreliable -- prefer `openVariableInDataExplorer`.**
  RESOLVED: Renamed `doubleClickVariableRow` to `openVariableInDataExplorer` for clarity.
  The old name caused the AI to abbreviate it as `doubleClickVariable` (wrong). The new
  name describes intent, not mechanism. `clickDatabaseIconForVariableRow` remains but its
  JSDoc warns it is unreliable and points to the renamed method.

- [x] **`waitForCurrentStaticPlot` vs `waitForCurrentPlot` -- confusing distinction.**
  RESOLVED: Renamed `waitForCurrentStaticPlot` to `waitForPlotInFullSizeViewer` to make
  the location distinction clear. `waitForCurrentPlot` remains the default for most
  plot assertions.

- [x] **Missing: deleteAllVariables (variables.ts)**
  RESOLVED: Added `deleteAllVariables()` to `variables.ts` that clicks the button AND
  confirms the modal dialog. Removed `clickDeleteAllVariables` to eliminate confusion.

## Diff Mode (Future)

- [ ] **File-to-area mapping file for CI automation.**
  A structured JSON mapping from path patterns to test areas (e.g.,
  `src/vs/workbench/contrib/positronVariables/**` -> `variables`).
  Enables deterministic file classification without AI reasoning.
  Required for GitHub Action integration where there is no AI in the loop.

- [ ] **Existing test discovery.**
  Automatically grep test files for changed method/component names and suggest
  re-running those existing e2e tests before generating new exploratory ones.
  Fastest signal for regressions.

- [ ] **GitHub Action integration.**
  Run `--diff` mode automatically on PRs and post results as an advisory PR comment.
  Depends on the file-to-area mapping file for deterministic behavior.

- [ ] **Cross-PR release testing.**
  Analyze all PRs merged since the last release tag to generate a comprehensive
  regression test plan covering all changed areas.
