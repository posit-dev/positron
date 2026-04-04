# POM Reference Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the qa-test skill's POM method selection by enriching the reference with JSDoc descriptions, standardizing JSDoc across high-traffic POMs, auditing `waitFor*` naming, and adding post-run failure analysis to the skill.

**Architecture:** The pipeline flows from POM source JSDoc -> generator extracts it -> enriched reference -> skill reads it and picks better. Post-run analysis in the skill detects gaps (raw Playwright fallback) and confusion (method retry) and routes feedback to BACKLOG.md or the report.

**Tech Stack:** TypeScript, Playwright POM pattern, markdown generation

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/generate-pom-reference.ts` | Modify | Extract JSDoc and include descriptions in output |
| `test/e2e/pages/plots.ts` | Modify | Add JSDoc to all public methods |
| `test/e2e/pages/console.ts` | Modify | Add JSDoc to all public methods |
| `test/e2e/pages/variables.ts` | Modify | Add JSDoc to all public methods |
| `test/e2e/pages/dataExplorer.ts` | Modify | Add JSDoc to all public methods |
| `test/e2e/pages/editors.ts` | Modify | Add JSDoc to all public methods |
| `test/e2e/tests/qa-generated/pom-reference.md` | Regenerated | Enriched output with descriptions |
| `.claude/skills/qa-test/SKILL.md` | Modify | Add post-run POM Health section and BACKLOG auto-filing |

---

### Task 1: Update Generator to Extract JSDoc

**Files:**
- Modify: `scripts/generate-pom-reference.ts:74-77,115-213,494-505`

This task changes the generator to capture JSDoc blocks preceding methods and include a one-line description in the reference output.

- [ ] **Step 1: Add `jsdoc` field to the `MethodSignature` interface**

In `scripts/generate-pom-reference.ts`, update the interface at line 74:

```typescript
interface MethodSignature {
	name: string;
	signature: string;
	jsdoc: string | null;
}
```

- [ ] **Step 2: Capture JSDoc blocks in `extractMethods`**

The current code at line 155 skips JSDoc lines:
```typescript
if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) {
	continue;
}
```

Replace the JSDoc-skipping logic with JSDoc-capturing logic. The key change: when we see `/**`, accumulate lines until `*/`, then attach to the next method found.

Replace lines 148-157 with:

```typescript
			// Only look at lines that START at depth 1 (direct class members)
			if (depthBeforeLine !== 1) {
				continue;
			}

			const trimmed = line.trim();

			// Skip empty lines, single-line comments, decorators
			if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@')) {
				continue;
			}

			// Capture JSDoc blocks
			if (trimmed.startsWith('/**')) {
				// Collect the full JSDoc block
				let jsdocBlock = trimmed;
				if (!trimmed.includes('*/')) {
					for (let j = i + 1; j < lines.length; j++) {
						const jsdocLine = lines[j].trim();
						jsdocBlock += '\n' + jsdocLine;
						if (jsdocLine.includes('*/')) {
							i = j; // advance outer loop past the JSDoc block
							break;
						}
					}
				}
				pendingJsdoc = jsdocBlock;
				continue;
			}

			// Skip lines that are mid-JSDoc (continuation lines starting with *)
			if (trimmed.startsWith('*')) {
				continue;
			}
```

Also declare `pendingJsdoc` near the top of the function, after `let depth = 0;`:

```typescript
let pendingJsdoc: string | null = null;
```

- [ ] **Step 3: Attach captured JSDoc to the method**

Where methods are pushed to the array (around line 207), change:

```typescript
if (cleaned) {
	methods.push({ name: methodName, signature: cleaned });
}
```

To:

```typescript
if (cleaned) {
	methods.push({ name: methodName, signature: cleaned, jsdoc: pendingJsdoc });
	pendingJsdoc = null;
}
```

Also clear `pendingJsdoc` when we encounter a non-method line that consumes it (e.g., a property declaration). After the `if (!methodMatch)` block around line 179, add:

```typescript
if (!methodMatch) {
	pendingJsdoc = null; // JSDoc was for a non-method member, discard
	continue;
}
```

- [ ] **Step 4: Add a helper to extract the first line from a JSDoc block**

Add this function before `generateReference()`:

```typescript
/**
 * Extract a one-line description from a JSDoc block.
 * Takes the first meaningful line, stripping Action:/Verify: prefixes for the reference.
 */
function extractJsdocSummary(jsdoc: string): string | null {
	const lines = jsdoc.split('\n');
	for (const line of lines) {
		const cleaned = line
			.replace(/^\/\*\*\s*/, '')  // opening /**
			.replace(/\*\/\s*$/, '')     // closing */
			.replace(/^\*\s?/, '')       // continuation *
			.trim();

		// Skip empty lines, @param, @see, @example, @returns tags
		if (!cleaned || cleaned.startsWith('@')) {
			continue;
		}

		// Strip Action:/Verify: prefix for the reference
		return cleaned.replace(/^(?:Action|Verify):\s*/i, '');
	}
	return null;
}

/**
 * Extract @see references from a JSDoc block.
 */
function extractJsdocSeeAlso(jsdoc: string): string[] {
	const sees: string[] = [];
	for (const line of jsdoc.split('\n')) {
		const cleaned = line.replace(/^\s*\*?\s*/, '').trim();
		const seeMatch = cleaned.match(/^@see\s+(\S+.*)/);
		if (seeMatch) {
			sees.push(seeMatch[1]);
		}
	}
	return sees;
}
```

- [ ] **Step 5: Update the markdown output to include descriptions**

In the `generateReference()` function, where methods are written (around line 501-502):

```typescript
for (const method of section.methods) {
	lines.push(`- ${method.signature}`);
}
```

Change to:

```typescript
for (const method of section.methods) {
	if (method.jsdoc) {
		const summary = extractJsdocSummary(method.jsdoc);
		const sees = extractJsdocSeeAlso(method.jsdoc);
		let line = `- ${method.signature}`;
		if (summary) {
			line += ` -- ${summary}`;
		}
		if (sees.length > 0) {
			line += ` (See also: ${sees.join(', ')})`;
		}
		lines.push(line);
	} else {
		lines.push(`- ${method.signature}`);
	}
}
```

Apply the same change for the sub-object methods block (around line 515-517).

- [ ] **Step 6: Regenerate the reference and verify**

Run:
```bash
npx tsx scripts/generate-pom-reference.ts
```

Expected: The output file `test/e2e/tests/qa-generated/pom-reference.md` now includes `-- description` after signatures for methods that have JSDoc. Check a few known JSDoc'd methods from `sessions.ts`:

```bash
grep "start(" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: The `start` method line should now include `-- Starts one or more sessions` or similar.

Also check that methods without JSDoc still appear as bare signatures:

```bash
grep "waitForCurrentPlot" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: No description appended (plots.ts has no JSDoc yet).

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-pom-reference.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "feat(e2e): include JSDoc descriptions in POM reference generator"
```

---

### Task 2: Add JSDoc to plots.ts

**Files:**
- Modify: `test/e2e/pages/plots.ts`

This POM has 0 JSDoc blocks and is the source of the `waitForCurrentPlot` vs `waitForCurrentStaticPlot` confusion. Every public method gets a JSDoc.

- [ ] **Step 1: Add JSDoc to every public method in plots.ts**

Open `test/e2e/pages/plots.ts` and add JSDoc blocks above each public method. Use the `Action:` / `Verify:` convention. Key methods:

```typescript
/** Action: Click the session name button displayed on the current plot. */
async clickSessionNameButton()

/** Action: Click the origin file button to navigate to the source file. */
async clickOriginFileButton()

/**
 * Action: Wait for any plot to appear in the Plots pane.
 * Matches plots rendered in the sidebar or editor. This is the default
 * plot assertion for matplotlib, seaborn, ggplot2, and other plot types.
 * @see waitForCurrentStaticPlot for static-only plots in the full-size viewer
 */
async waitForCurrentPlot()

/**
 * Action: Wait for a static (non-webview) plot image in the full-size plot viewer.
 * Only matches `.static-plot-instance img` -- does not match webview plots or
 * sidebar thumbnails. Use waitForCurrentPlot for general plot assertions.
 * @see waitForCurrentPlot for general plot detection (sidebar + editor)
 */
async waitForCurrentStaticPlot()

/** Verify: The origin file button is visible in the Plots pane. */
async expectOriginButtonVisible()

/**
 * Verify: The origin file button contains the expected text.
 * @param text - Expected text content in the origin file button
 */
async expectOriginButtonContain(text: string)

/**
 * Action: Get a locator for an element inside a webview plot.
 * Use for htmlwidgets, plotly, and other interactive plots rendered in webviews.
 * @param selector - CSS selector to find within the webview iframe
 */
getWebviewPlotLocator(selector: string): Locator

/**
 * Action: Get a locator for an element inside a deeply nested webview plot.
 * Use for R htmlwidgets that use an extra iframe layer (e.g., Shiny, leaflet).
 * @param selector - CSS selector to find within the nested webview iframe
 */
getDeepWebWebviewPlotLocator(selector: string): Locator

/**
 * Action: Wait for a webview-based plot to appear.
 * Use for interactive plots (plotly, htmlwidgets) rendered inside webview iframes.
 * @param selector - CSS selector to match within the webview
 * @param state - Wait for 'attached' (in DOM) or 'visible' (rendered). Default: 'visible'
 * @param RWeb - Set true for R htmlwidgets with an extra iframe nesting layer
 * @see waitForCurrentPlot for static image plots (matplotlib, ggplot2)
 */
async waitForWebviewPlot(selector: string, state: 'attached' | 'visible' = 'visible', RWeb = false)

/** Action: Clear all plots from the Plots pane. No-op if no plots exist. */
async clearPlots()

/**
 * Verify: No plots are visible in the Plots pane.
 * @param options.timeout - How long to wait for plots to disappear. Default: 15000ms
 */
async waitForNoPlots({ timeout = 15000 }: { timeout?: number } = {})

/** Action: Capture the current plot as a screenshot buffer. */
async getCurrentPlotAsBuffer(): Promise<Buffer>

/**
 * Action: Capture the current static plot as a screenshot buffer.
 * @see getCurrentPlotAsBuffer for the general version
 */
async getCurrentStaticPlotAsBuffer(): Promise<Buffer>

/** Action: Click the copy-to-clipboard button on the current plot. */
async copyCurrentPlotToClipboard()

/**
 * Action: Save the current plot from the Plots pane sidebar.
 * Opens the save dialog, fills in name and format, and handles overwrite.
 * @param name - File name for the saved plot (without extension)
 * @param format - Image format: 'JPEG', 'PNG', 'SVG', 'PDF', or 'TIFF'
 * @param overwrite - Whether to overwrite if file exists. Default: true
 * @see savePlotFromEditor to save from an editor tab instead
 */
async savePlotFromPlotsPane({ name, format, overwrite = true }: ...)

/**
 * Action: Save the current plot from the editor tab.
 * Opens the save dialog, fills in name and format, and handles overwrite.
 * @param name - File name for the saved plot (without extension)
 * @param format - Image format: 'JPEG', 'PNG', 'SVG', 'PDF', or 'TIFF'
 * @param overwrite - Whether to overwrite if file exists. Default: true
 * @see savePlotFromPlotsPane to save from the sidebar instead
 */
async savePlotFromEditor({ name, format, overwrite = true }: ...)

/** Action: Click the "Go to file" button on the current plot. */
async clickGoToFileButton()

/**
 * Action: Set the zoom level for the current plot.
 * @param zoomLevel - Target zoom: 'Fit', '50%', '75%', '100%', or '200%'
 */
async setThePlotZoom(zoomLevel: ZoomLevels)

/**
 * Action: Open the current plot in a specified location.
 * @param plotLocation - Where to open: 'editor', 'new window', or 'editor tab to the side'
 */
async openPlotIn(plotLocation: PlotLocations)

/** Action: Click the main "Open in editor tab" button (no dropdown). */
async clickOpenInEditorButton()

/**
 * Verify: The "Open in Editor" dropdown has the expected option checked.
 * @param expectedOption - Which location should be checked: 'editor', 'new window', or 'editor tab to the side'
 */
async verifyOpenPlotDropdownCheckedOption(expectedOption: PlotLocations)

/** Action: Wait for a plot image to appear in an editor tab (not the sidebar). */
async waitForPlotInEditor()

/**
 * Verify: The expected number of plot thumbnails are visible.
 * @param count - Expected number of thumbnail images
 */
async expectPlotThumbnailsCountToBe(count: number)

/** Action: Enlarge the Plots pane area by dragging sashes inward. */
async enlargePlotArea()

/** Action: Restore the Plots pane area to its original size after enlarging. */
async restorePlotArea()

/**
 * Action: Resize the Plots pane area by dragging sashes.
 * @param xDelta - Horizontal drag distance in pixels (negative = enlarge)
 * @param yDelta - Vertical drag distance in pixels (negative = enlarge)
 */
async alterPlotArea(xDelta: number, yDelta: number)
```

- [ ] **Step 2: Regenerate reference and verify plots descriptions appear**

```bash
npx tsx scripts/generate-pom-reference.ts
grep -A1 "waitForCurrentPlot\|waitForCurrentStaticPlot" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: Both methods now have descriptions and `(See also: ...)` cross-references.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/pages/plots.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "docs(e2e): add JSDoc to all public methods in plots.ts"
```

---

### Task 3: Add JSDoc to console.ts

**Files:**
- Modify: `test/e2e/pages/console.ts`

Console has only 4 JSDoc blocks across 29 public methods. This is the most-used POM by the qa-test skill.

- [ ] **Step 1: Read console.ts and add JSDoc to every undocumented public method**

Key methods to document (use the same `Action:`/`Verify:` convention):

- `executeCode` -- most important. Note: waits for execution to complete by default.
- `typeToConsole` -- types text without executing. Note the `pressEnter` param.
- `waitForReady` -- waits for the console prompt (e.g., `>>>` for Python, `>` for R).
- `waitForConsoleContents` -- waits for specific text to appear in console output.
- `sendInterrupt` / `interruptExecution` -- distinguish these if they differ, or `@see` each other.
- `expectConsoleToContainError` -- verify an error message appeared.
- `expectSuggestionListCount` / `expectSuggestionListToContain` -- autocomplete verification.

Read the file to understand each method's behavior before writing JSDoc. Add `@see` cross-references where methods are easily confused (e.g., `sendInterrupt` vs `interruptExecution`, `typeToConsole` vs `pasteCodeToConsole`).

- [ ] **Step 2: Regenerate reference and verify**

```bash
npx tsx scripts/generate-pom-reference.ts
grep "executeCode" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: `executeCode` line now includes description.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/pages/console.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "docs(e2e): add JSDoc to all public methods in console.ts"
```

---

### Task 4: Add JSDoc to variables.ts

**Files:**
- Modify: `test/e2e/pages/variables.ts`

Variables has 9 JSDoc blocks across 25 public methods. Fill the gaps, and importantly document the `clickDatabaseIconForVariableRow` vs `doubleClickVariableRow` distinction.

- [ ] **Step 1: Read variables.ts and add JSDoc to every undocumented public method**

Key methods:

- `doubleClickVariableRow` -- note this is the reliable way to open a variable in Data Explorer.
- `clickDatabaseIconForVariableRow` -- note this can be unreliable; `@see doubleClickVariableRow`.
- `toggleVariable` / `expandVariable` / `collapseVariable` -- document the expand/collapse behavior.
- `getVariableChildren` -- returns child variables as key-value pairs.
- `expectVariableToBe` -- the primary assertion method for variable values.
- `selectSession` / `selectVariablesGroup` -- session/group switching.

- [ ] **Step 2: Regenerate reference and verify**

```bash
npx tsx scripts/generate-pom-reference.ts
grep "doubleClickVariableRow\|clickDatabaseIcon" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: Both methods have descriptions with `@see` cross-references.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/pages/variables.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "docs(e2e): add JSDoc to all public methods in variables.ts"
```

---

### Task 5: Add JSDoc to dataExplorer.ts

**Files:**
- Modify: `test/e2e/pages/dataExplorer.ts`

The largest POM (~68 methods, 17 existing JSDoc blocks). Has nested sub-classes (Filters, EditorActionBar, DataGrid, SummaryPanel, ConvertToCodeModal).

- [ ] **Step 1: Read dataExplorer.ts and add JSDoc to every undocumented public method**

This file is large. Work through it class by class:

1. **Main DataExplorer class:** `maximize`, `waitForIdle`, `expectStatusBarToHaveText`
2. **Filters sub-class:** `add`, `clearAll`
3. **EditorActionBar sub-class:** `clickButton`, `expectToHaveButton`, `verifyCanOpenAsPlaintext`
4. **DataGrid sub-class:** All grid interaction methods. Key notes:
   - `columnIndex` is 1-based in grid methods
   - `rowIndex`/`colIndex` for cells are 0-based
   - Document this clearly in `@param` tags
5. **SummaryPanel sub-class:** `show`, `hide`, `expandColumnProfile`, `getColumnProfileInfo`, etc.
6. **ConvertToCodeModal sub-class:** `clickOK`, `clickCancel`, `expectToBeVisible`

- [ ] **Step 2: Regenerate reference and verify**

```bash
npx tsx scripts/generate-pom-reference.ts
grep "expandColumnProfile\|maximize" test/e2e/tests/qa-generated/pom-reference.md
```

Expected: Descriptions appear for documented methods.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/pages/dataExplorer.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "docs(e2e): add JSDoc to all public methods in dataExplorer.ts"
```

---

### Task 6: Add JSDoc to editors.ts

**Files:**
- Modify: `test/e2e/pages/editors.ts`

Editors has 5 JSDoc blocks across ~18 public methods. Fill gaps.

- [ ] **Step 1: Read editors.ts and add JSDoc to every undocumented public method**

Key methods:

- `clickTab` / `selectTab` / `verifyTab` -- document the distinctions
- `expectEditorGroupCount` -- important for multi-editor layouts
- `waitForActiveTab` / `waitForActiveEditor` -- document the difference
- `newUntitledFile` -- creates a new empty file
- `saveOpenedFile` -- saves the currently focused editor

- [ ] **Step 2: Regenerate reference and verify**

```bash
npx tsx scripts/generate-pom-reference.ts
grep "clickTab\|selectTab" test/e2e/tests/qa-generated/pom-reference.md
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/pages/editors.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "docs(e2e): add JSDoc to all public methods in editors.ts"
```

---

### Task 7: Audit `waitFor*` Methods Across Tier 1 POMs

**Files:**
- Modify: `test/e2e/pages/plots.ts`, `test/e2e/pages/console.ts`, `test/e2e/pages/variables.ts`, `test/e2e/pages/dataExplorer.ts`, `test/e2e/pages/editors.ts`

- [ ] **Step 1: Find all `waitFor*` methods in Tier 1 POMs**

```bash
grep -n "async waitFor" test/e2e/pages/plots.ts test/e2e/pages/console.ts test/e2e/pages/variables.ts test/e2e/pages/dataExplorer.ts test/e2e/pages/editors.ts
```

- [ ] **Step 2: For each, check if it is used as an assertion (last call in a test)**

```bash
# For each waitFor* method, check how it's used in test files
grep -rn "waitForCurrentPlot\b" test/e2e/tests/ --include="*.ts" | tail -5
```

If a `waitFor*` method is commonly the last call in a test or test group AND no `expect*` equivalent exists, flag it for an `expect*` wrapper.

- [ ] **Step 3: Add `expect*` counterparts for flagged methods**

For each flagged method, add a thin wrapper. Example for plots:

```typescript
/**
 * Verify: A plot is visible in the Plots pane.
 * @see waitForCurrentPlot if you need to wait before interacting with the plot
 */
async expectCurrentPlotVisible() {
	await test.step('Expect current plot to be visible', async () => {
		await expect(this.code.driver.page.locator(CURRENT_PLOT)).toBeVisible({ timeout: 30000 });
	});
}
```

Update the JSDoc on the original `waitFor*` method to add `@see expectCurrentPlotVisible` pointing to the new verification method.

- [ ] **Step 4: Regenerate reference and verify new methods appear**

```bash
npx tsx scripts/generate-pom-reference.ts
grep "expectCurrentPlotVisible" test/e2e/tests/qa-generated/pom-reference.md
```

- [ ] **Step 5: Commit**

```bash
git add test/e2e/pages/plots.ts test/e2e/pages/console.ts test/e2e/pages/variables.ts test/e2e/pages/dataExplorer.ts test/e2e/pages/editors.ts test/e2e/tests/qa-generated/pom-reference.md
git commit -m "feat(e2e): add expect* counterparts for waitFor* methods used as assertions"
```

---

### Task 8: Add Post-Run POM Health Analysis to Skill

**Files:**
- Modify: `.claude/skills/qa-test/SKILL.md`

- [ ] **Step 1: Add POM Health section to the results report template**

In `.claude/skills/qa-test/SKILL.md`, in the Step 4 (Report Results) section, after the existing `### POM Recommendations` block (around line 464-488), add:

```markdown
### POM Health
[Include when the skill retried a step with a different POM method, or fell
back to raw Playwright actions. Categorize each finding.]

**Method Confusion** (retried with a different POM method that succeeded):
```
- CONFUSION: Called `<original>` (failed), retried with `<replacement>` (passed).
  JSDoc on original: <present/missing>. JSDoc on replacement: <present/missing>.
  Recommendation: <Add @see cross-references / Update JSDoc to clarify distinction>
```

**POM Gap** (fell back to raw Playwright because no POM method existed):
```
- GAP: Used raw `<action>` with selector `<selector>` because no POM method covers <intent>.
  Suggested POM: <pom>.ts
  Suggested method: `<methodName>(<params>): Promise<void>`
```

When a POM Gap is detected, also auto-append it to `test/e2e/tests/explore/BACKLOG.md`
under `## POM Gaps`:

```markdown
- [ ] **Missing: <methodName> (<pom>.ts)**
  During QA test "<test title>", no POM method existed for <intent>.
  Used raw `<action>` with `<selector>`.
  Suggested signature: `<methodName>(<params>): Promise<void>`
  Discovered: <date>
```
```

- [ ] **Step 2: Update failure handling guidance**

In the Step 3b (Failure Handling and Retries) section, add guidance to track what changed between attempts:

After the existing retry guidance, add:

```markdown
5. **Track divergences for POM Health reporting.** When a retry succeeds with a different
   POM method or a raw Playwright fallback, note the original method, the replacement,
   and whether either had JSDoc in the reference. Report this in Step 4 under POM Health.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa-test/SKILL.md
git commit -m "feat(qa-test): add post-run POM Health analysis to skill"
```

---

### Task 9: Final Regeneration and Verification

- [ ] **Step 1: Regenerate the full reference one final time**

```bash
npx tsx scripts/generate-pom-reference.ts
```

- [ ] **Step 2: Spot-check the reference for correctness**

Check that:
1. Methods with JSDoc have descriptions: `grep " -- " test/e2e/tests/qa-generated/pom-reference.md | head -20`
2. Methods without JSDoc are bare signatures: `grep -v " -- " test/e2e/tests/qa-generated/pom-reference.md | grep "^- " | head -10`
3. `@see` references appear as `(See also: ...)`: `grep "See also" test/e2e/tests/qa-generated/pom-reference.md`
4. New `expect*` methods appear: `grep "expectCurrentPlotVisible" test/e2e/tests/qa-generated/pom-reference.md`

- [ ] **Step 3: Run a quick qa-test to validate the skill reads the enriched reference**

```bash
# A quick --build test to confirm the skill picks methods with descriptions
# This is a manual sanity check, not automated
```

- [ ] **Step 4: Commit final reference**

```bash
git add test/e2e/tests/qa-generated/pom-reference.md
git commit -m "chore(e2e): regenerate POM reference with JSDoc descriptions"
```
