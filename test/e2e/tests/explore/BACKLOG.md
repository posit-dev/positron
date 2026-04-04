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

- [ ] **Ghost cell POM methods missing.**
  No POM exists for interacting with ghost cells. During QA #12025 testing, we had to
  use raw selectors (`.ghost-cell-info-button`, `.ghost-cell-container`) and the command
  palette (`positronNotebook.showGhostCellInfo`) instead of proper POM methods. Needed:
  - `expectGhostCellVisible()` / `expectGhostCellNotVisible()`
  - `clickGhostCellInfoButton()` -- opens the info modal dialog
  - `acceptGhostCellSuggestion()` / `dismissGhostCellSuggestion()`
  - `expectGhostCellInfoDialogContent(expectations)` -- verify dialog sections
  - Test with: `#12025` (ghost cell info pane content)

- [ ] **Ghost cell opt-in/enable flow not in POM.**
  First-time notebook users see a "Suggest code as you work?" opt-in prompt with
  Enable / Not now / Don't ask again buttons. There is no POM method to handle this.
  Needed:
  - `enableGhostCellSuggestions()` -- clicks Enable on the opt-in prompt
  - `dismissGhostCellOptIn()` -- clicks Not now
  - `disableGhostCellOptIn()` -- clicks Don't ask again
  - `expectGhostCellOptInVisible()` / `expectGhostCellOptInNotVisible()`
  - Test with: `#12025` (opt-in prompt appears on first notebook with ghost cells)

- [ ] **`clickDatabaseIconForVariableRow` unreliable -- prefer `doubleClickVariableRow`.**
  During QA testing, `clickDatabaseIconForVariableRow("df")` timed out after 15s while
  `doubleClickVariableRow("df")` opened the Data Explorer immediately. The database icon
  may have visibility or hover-trigger issues. For now, use `doubleClickVariableRow` as the
  reliable way to open a variable in Data Explorer. Investigate whether the icon click needs
  a hover-to-reveal step or if the locator is stale.

- [x] **`waitForCurrentStaticPlot` vs `waitForCurrentPlot` -- confusing distinction.**
  RESOLVED: Renamed `waitForCurrentStaticPlot` to `waitForPlotInFullSizeViewer` to make
  the location distinction clear. `waitForCurrentPlot` remains the default for most
  plot assertions.
