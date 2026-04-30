# Release Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright-based pipeline that produces release screenshots for the docs site (https://positron.posit.co/), starting with a 5-page pilot.

**Architecture:** New Playwright project `release-screenshots` runs alongside existing `e2e-electron`/`e2e-windows`/etc. projects. Tests live in `test/e2e/release-screenshots/`, use file extension `*.screenshot.ts` (so existing projects don't pick them up), and produce PNGs in a gitignored `output/` folder named to match the docs site's image paths. Tests reuse existing POMs (`app.workbench.variables`, `app.workbench.dataExplorer`, etc.) for state setup; only screenshot-specific helpers (capture primitives + visual cleanup) are new.

**Tech Stack:** Playwright (Electron driver), TypeScript, existing Positron e2e infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-30-release-screenshots-design.md`

---

## File Structure

**New files:**

- `test/e2e/release-screenshots/helpers/screenshot-utils.ts` - capture primitives (`captureFullWindow`, `capturePanel`, output-path helper)
- `test/e2e/release-screenshots/helpers/layout-utils.ts` - visual cleanup before capture (`prepareForScreenshot`, `hideToasts`, `waitForStableUI`)
- `test/e2e/release-screenshots/welcome.screenshot.ts` - full-window Welcome shot
- `test/e2e/release-screenshots/launch-positron.screenshot.ts` - clean app at startup
- `test/e2e/release-screenshots/variables-pane.screenshot.ts` - populated Variables pane
- `test/e2e/release-screenshots/data-explorer.screenshot.ts` - Data Explorer main panel
- `test/e2e/release-screenshots/filter-bar.screenshot.ts` - Data Explorer filter bar focused

**Modified files:**

- `playwright.config.ts` - add `release-screenshots` project and add folder to `baseIgnore`
- `.gitignore` - ignore `test/e2e/release-screenshots/output/`

**Auto-created at runtime:**

- `test/e2e/release-screenshots/output/*.png` - the screenshot artifacts (gitignored)

---

## Task 1: Add Playwright project and gitignore

Adds the runner scaffolding so subsequent tasks have somewhere to land.

**Files:**

- Modify: `playwright.config.ts:31-36` (extend `baseIgnore`)
- Modify: `playwright.config.ts:84-216` (add `release-screenshots` project entry)
- Modify: `.gitignore`

- [ ] **Step 1: Add output folder to .gitignore**

Append to `.gitignore`:

```
test/e2e/release-screenshots/output/
```

- [ ] **Step 2: Add `release-screenshots` to `baseIgnore` in `playwright.config.ts`**

Locate the `baseIgnore` array (currently at `playwright.config.ts:31-36`):

```ts
const baseIgnore = [
	'example.test.ts',
	'**/workbench/**',
	'**/remote-ssh/**',
	'**/assistant-eval/**',
];
```

Add the new entry:

```ts
const baseIgnore = [
	'example.test.ts',
	'**/workbench/**',
	'**/remote-ssh/**',
	'**/assistant-eval/**',
	'**/release-screenshots/**',
];
```

- [ ] **Step 3: Add the `release-screenshots` project entry**

In the `projects` array in `playwright.config.ts`, add a new entry after the last existing project (e.g. after `e2e-jupyter`). Use the same shape as `e2e-electron` but target the `*.screenshot.ts` extension and the new folder:

```ts
{
	name: 'release-screenshots',
	testDir: './test/e2e/release-screenshots',
	testMatch: '*.screenshot.ts',
	testIgnore: [],
	use: {
		artifactDir: 'release-screenshots',
	},
},
```

Notes for the implementer:

- `testMatch: '*.screenshot.ts'` overrides the config-level default of `*.test.ts`, so other projects' globs won't match these files.
- `testIgnore: []` overrides the config-level `testIgnore` (which excludes `**/release-screenshots/**` for safety) so this project actually runs the screenshot tests.

- [ ] **Step 4: Verify the project is registered**

Run:

```bash
npx playwright test --list --project release-screenshots
```

Expected: command exits 0, lists 0 tests (no `.screenshot.ts` files exist yet). If you see "Project not found" or test files from other projects, revisit Step 3.

- [ ] **Step 5: Verify the file-extension barrier works**

The primary isolation mechanism is the file extension: existing projects use the config-level default `testMatch: '*.test.ts'`, while `release-screenshots` uses `'*.screenshot.ts'`. Sanity-check this with a temporary marker file:

```bash
mkdir -p test/e2e/release-screenshots
echo "// placeholder" > test/e2e/release-screenshots/_marker.screenshot.ts
npx playwright test --list --project e2e-electron --grep _marker
npx playwright test --list --project release-screenshots --grep _marker
rm test/e2e/release-screenshots/_marker.screenshot.ts
```

Expected: `e2e-electron` matches 0 tests (extension does not match), `release-screenshots` matches the marker.

Note on `baseIgnore`: a few existing projects (`e2e-electron`, `e2e-workbench`, `e2e-remote-ssh`, `e2e-jupyter`) define their own `testIgnore` arrays that override the config-level one, so the addition in Step 2 only protects projects that fall through to the default. The file extension is what guarantees isolation - `baseIgnore` is just defense in depth.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts .gitignore
git commit -m "feat(e2e): add release-screenshots Playwright project"
```

---

## Task 2: Implement screenshot-utils.ts (capture primitives)

The two capture functions all tests depend on. Resolves output paths internally so test files only pass a filename.

**Files:**

- Create: `test/e2e/release-screenshots/helpers/screenshot-utils.ts`

- [ ] **Step 1: Write `screenshot-utils.ts`**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from '@playwright/test';
import * as path from 'path';

/**
 * Resolve a filename to its absolute output path under
 * `test/e2e/release-screenshots/output/`. Tests pass a bare filename
 * (e.g. 'welcome.png') and never construct paths themselves.
 */
function outputPath(filename: string): string {
	return path.resolve(__dirname, '..', 'output', filename);
}

/**
 * Capture the entire Electron window and write it to the output folder.
 * Used for full-app shots like the Welcome page.
 */
export async function captureFullWindow(page: Page, filename: string): Promise<void> {
	await page.screenshot({
		path: outputPath(filename),
		fullPage: false, // Electron window is the viewport; no scrolling
	});
}

/**
 * Capture a single panel/element and write it to the output folder.
 * Used for panel shots like Connections Pane, Variables Pane.
 *
 * The locator must resolve to exactly one element. Callers should ensure
 * the panel is visible and stable before calling.
 */
export async function capturePanel(locator: Locator, filename: string): Promise<void> {
	await locator.screenshot({
		path: outputPath(filename),
	});
}
```

- [ ] **Step 2: Verify it type-checks via the daemon**

Run:

```bash
npm run build-ps
```

If daemons aren't running, start them with `npm run build-start` and proceed (they compile in the background). After ~30-60s:

```bash
npm run build-check
```

Expected: no errors mentioning `screenshot-utils.ts`.

- [ ] **Step 3: Commit**

```bash
git add test/e2e/release-screenshots/helpers/screenshot-utils.ts
git commit -m "feat(e2e): add release-screenshots capture primitives"
```

---

## Task 3: Implement layout-utils.ts (visual cleanup)

Pre-capture cleanup so screenshots don't include transient UI like notification toasts or hover tooltips.

**Files:**

- Create: `test/e2e/release-screenshots/helpers/layout-utils.ts`

- [ ] **Step 1: Write `layout-utils.ts`**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';
import { Application } from '../../infra';

/**
 * Hide any visible notification toasts. Toasts appear from many normal
 * interactions (interpreter started, file opened, etc.) and would otherwise
 * leak into screenshots.
 */
export async function hideToasts(app: Application): Promise<void> {
	await app.workbench.quickaccess.runCommand('notifications.hideToasts');
}

/**
 * Move the mouse off-screen so no element is in a `:hover` state when
 * the screenshot is taken. Hover overlays (tooltips, action bar buttons,
 * column header cursors) are common screenshot pollutants.
 */
export async function unhoverAll(page: Page): Promise<void> {
	await page.mouse.move(0, 0);
}

/**
 * Wait for the workbench to be visually stable. A short fixed wait after
 * `requestAnimationFrame` covers most CSS transitions and async layout reflow.
 *
 * If a specific test needs to wait for a specific locator/state, do that with
 * `expect(...).toBeVisible()` *before* calling this helper.
 */
export async function waitForStableUI(page: Page, ms = 250): Promise<void> {
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));
	await page.waitForTimeout(ms);
}

/**
 * Standard pre-screenshot cleanup. Composes the smaller helpers in the order
 * that produces a clean, deterministic frame:
 *   1. Hide notification toasts (they cover real UI)
 *   2. Unhover (no spurious hover states)
 *   3. Wait for layout to settle
 *
 * Call this immediately before `captureFullWindow` / `capturePanel`. Set up
 * world state with POMs first, then call this once, then capture.
 */
export async function prepareForScreenshot(app: Application, page: Page): Promise<void> {
	await hideToasts(app);
	await unhoverAll(page);
	await waitForStableUI(page);
}
```

- [ ] **Step 2: Verify it type-checks**

Run:

```bash
npm run build-check
```

Expected: no errors mentioning `layout-utils.ts`.

If `Application` import path is wrong, check `test/e2e/infra/index.ts` for the correct export and adjust. Cross-reference how `test/e2e/demos/demo-utils.ts` imports `Application` (line 8: `import { Application } from '../infra';` - same relative depth as our helpers folder is one level deeper, so we need `../../infra`).

- [ ] **Step 3: Commit**

```bash
git add test/e2e/release-screenshots/helpers/layout-utils.ts
git commit -m "feat(e2e): add release-screenshots layout cleanup helpers"
```

---

## Task 4: First pilot test - welcome.screenshot.ts

Welcome is the simplest page (no setup needed - it's the default state) and validates the whole pipeline end-to-end. Doing this one first surfaces any plumbing bugs before we layer in interpreter setup.

**Files:**

- Create: `test/e2e/release-screenshots/welcome.screenshot.ts`

- [ ] **Step 1: Write the screenshot test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.describe('Release screenshots - Welcome', () => {
	test('welcome page', async ({ app, page }) => {
		// Welcome is the default tab on launch; just verify it's there.
		await app.workbench.welcome.expectLogoToBeVisible();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'welcome.png');
	});
});
```

- [ ] **Step 2: Run the screenshot test**

Run:

```bash
npx playwright test --project release-screenshots --grep "welcome page"
```

Expected: 1 passed. The test "passes" by completing without throwing - there are no assertions in the screenshot path itself, only the POM-level `expectLogoToBeVisible`.

- [ ] **Step 3: Verify the PNG was created**

Run:

```bash
ls -la test/e2e/release-screenshots/output/welcome.png
```

Expected: file exists, non-zero size (typically 100KB-1MB).

- [ ] **Step 4: Eyeball the PNG**

Open `test/e2e/release-screenshots/output/welcome.png` in any image viewer. Verify:

- Full Positron window is captured (not just a panel).
- Welcome content is visible (Posit logo, "New Notebook"/"New File" buttons, recent items section).
- No notification toasts in frame.
- No hover overlays (all buttons in resting state).

If any of these fail, debug before moving on - subsequent tests reuse this same plumbing.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/release-screenshots/welcome.screenshot.ts
git commit -m "feat(e2e): add release screenshot for Welcome page"
```

---

## Task 5: launch-positron.screenshot.ts

A clean app-launch shot. Similar to Welcome but with the workbench in a "freshly opened, no work in progress" state.

**Files:**

- Create: `test/e2e/release-screenshots/launch-positron.screenshot.ts`

- [ ] **Step 1: Confirm what the docs page actually shows**

Open https://positron.posit.co/launch-positron-from-terminal.html (or the closest matching doc page on the live site) and note:

- What the screenshot depicts (whole window? specific area?)
- The exact `<img src=...>` filename (we will match it).

If the live filename is different from `launch-positron.png`, use the live one. The default name below assumes `launch-positron.png`.

- [ ] **Step 2: Write the screenshot test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.describe('Release screenshots - Launch Positron', () => {
	test('app at launch', async ({ app, page }) => {
		// On launch the Welcome tab is active by default. Verify it's there
		// so a layout regression doesn't silently produce a blank shot.
		await app.workbench.welcome.expectLogoToBeVisible();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'launch-positron.png');
	});
});
```

- [ ] **Step 3: Run the test**

Run:

```bash
npx playwright test --project release-screenshots --grep "app at launch"
```

Expected: 1 passed.

- [ ] **Step 4: Eyeball the PNG**

Open `test/e2e/release-screenshots/output/launch-positron.png` and confirm it matches what the docs page is currently using. If the docs page actually wants a different state (e.g. "with sidebar visible"/"with terminal visible"), adjust the test to match before moving on.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/release-screenshots/launch-positron.screenshot.ts
git commit -m "feat(e2e): add release screenshot for Launch Positron page"
```

---

## Task 6: variables-pane.screenshot.ts

First test that requires world setup: start a Python interpreter, declare a few variables, then capture just the Variables pane.

**Files:**

- Create: `test/e2e/release-screenshots/variables-pane.screenshot.ts`

- [ ] **Step 1: Write the screenshot test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { capturePanel } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

const SETUP_CODE = `
import pandas as pd
import numpy as np

# Variables that demonstrate the pane's value-rendering for common types
df = pd.DataFrame({
    'name': ['Ada', 'Linus', 'Grace'],
    'birth_year': [1815, 1969, 1906],
    'field': ['math', 'systems', 'compilers'],
})
arr = np.array([1.0, 2.5, 3.14])
greeting = "hello, positron"
counter = 42
`.trim();

test.describe('Release screenshots - Variables pane', () => {
	test('populated', async ({ app, page, executeCode, python }) => {
		await executeCode('Python', SETUP_CODE);
		await app.workbench.variables.waitForVariableRow('df');
		await app.workbench.variables.waitForVariableRow('greeting');

		await prepareForScreenshot(app, page);
		await capturePanel(app.workbench.variables.variablesPane, 'variables-pane.png');
	});
});
```

Notes:

- `python` fixture starts a Python interpreter before the test runs.
- `executeCode` fixture is the standard way tests run code in the active interpreter.
- `app.workbench.variables.variablesPane` is the existing locator (see `test/e2e/pages/variables.ts:34`) - we reuse it directly rather than re-defining a selector.

- [ ] **Step 2: Run the test**

Run:

```bash
npx playwright test --project release-screenshots --grep "Variables pane"
```

Expected: 1 passed. Note that this test takes longer (interpreter startup + code execution) - typically 20-40s.

- [ ] **Step 3: Eyeball the PNG**

Open `test/e2e/release-screenshots/output/variables-pane.png` and verify:

- Only the Variables pane is in frame (not the whole window).
- All four variables are visible: `df`, `arr`, `greeting`, `counter`.
- Types render correctly (DataFrame [3x3], ndarray, str, int).
- No hover state on any row.

If the panel boundary is wrong (cuts off content, includes too much chrome), the locator may need refinement; check `app.workbench.variables.variablesPane` definition.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/release-screenshots/variables-pane.screenshot.ts
git commit -m "feat(e2e): add release screenshot for Variables pane"
```

---

## Task 7: data-explorer.screenshot.ts

Open a DataFrame in the Data Explorer, wait for the grid to become idle, then capture.

**Files:**

- Create: `test/e2e/release-screenshots/data-explorer.screenshot.ts`

- [ ] **Step 1: Write the screenshot test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

const SETUP_CODE = `
import pandas as pd

# A dataset rich enough to show off all three Data Explorer regions:
# the summary panel (left), the column profile, and the data grid (right).
df = pd.DataFrame({
    'name':   ['Jai', 'Princi', 'Gaurav', 'Anuj', 'Ada', 'Linus', 'Grace'],
    'age':    [27, 24, 22, 32, 28, 30, 26],
    'city':   ['Delhi', 'Kanpur', 'Allahabad', 'Kannauj', 'London', 'Helsinki', 'New York'],
    'salary': [55000, 48000, 51000, 60000, 72000, 95000, 68000],
})
`.trim();

test.describe('Release screenshots - Data Explorer', () => {
	test('main panel', async ({ app, page, executeCode, python, hotKeys }) => {
		const { dataExplorer, variables } = app.workbench;

		await executeCode('Python', SETUP_CODE);
		await variables.doubleClickVariableRow('df');

		// Maximize the editor area so the screenshot focuses on the explorer.
		await dataExplorer.maximize(/* showSummaryPanel */ true);
		await dataExplorer.waitForIdle();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'data-explorer.png');
	});
});
```

Notes:

- `dataExplorer.maximize(true)` collapses sidebars and shows the summary panel - matches the framing typically used in the docs.
- `waitForIdle` waits for the data grid's idle status indicator (existing POM method, see `test/e2e/pages/dataExplorer.ts:62`).

- [ ] **Step 2: Run the test**

Run:

```bash
npx playwright test --project release-screenshots --grep "Data Explorer"
```

Expected: 1 passed.

- [ ] **Step 3: Eyeball the PNG**

Open `test/e2e/release-screenshots/output/data-explorer.png` and verify:

- Data Explorer is maximized (sidebars collapsed).
- Summary panel is visible on the left with all four columns listed.
- Data grid shows all 7 rows of sample data.
- Status bar at the bottom is visible and shows "idle" / row count.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/release-screenshots/data-explorer.screenshot.ts
git commit -m "feat(e2e): add release screenshot for Data Explorer page"
```

---

## Task 8: filter-bar.screenshot.ts

Same world setup as Data Explorer, but the screenshot focuses on the filter row state.

**Files:**

- Create: `test/e2e/release-screenshots/filter-bar.screenshot.ts`

- [ ] **Step 1: Confirm what "Filter Bar" means in the docs**

Open the docs site and find the page that uses a `filter-bar.png` (or similar). It's likely a sub-page of Data Explorer. Note:

- Whether it's a closeup of the column-header filter row, or the summary panel's filter row, or a "Filtering" modal/popover.
- The exact image filename being referenced.

The test below captures **a Data Explorer with a single active column filter**, which is the most common interpretation. Adjust the test if the live docs use a different framing.

- [ ] **Step 2: Write the screenshot test**

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

const SETUP_CODE = `
import pandas as pd

df = pd.DataFrame({
    'name':   ['Jai', 'Princi', 'Gaurav', 'Anuj', 'Ada', 'Linus', 'Grace'],
    'age':    [27, 24, 22, 32, 28, 30, 26],
    'city':   ['Delhi', 'Kanpur', 'Allahabad', 'Kannauj', 'London', 'Helsinki', 'New York'],
    'salary': [55000, 48000, 51000, 60000, 72000, 95000, 68000],
})
`.trim();

test.describe('Release screenshots - Data Explorer filter bar', () => {
	test('with active filter', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;

		await executeCode('Python', SETUP_CODE);
		await variables.doubleClickVariableRow('df');
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();

		// Add a single filter so the filter bar is in its "populated" state.
		// `filters.add` is the existing POM method, see test/e2e/pages/dataExplorer.ts.
		await dataExplorer.filters.add({
			columnName: 'age',
			condition: 'is greater than or equal to',
			value: '25',
		});
		await dataExplorer.waitForIdle();

		await prepareForScreenshot(app, page);
		await captureFullWindow(page, 'filter-bar.png');
	});
});
```

Notes:

- `dataExplorer.filters.add(...)` is the existing POM method. Confirm valid condition strings against existing tests in `test/e2e/tests/data-explorer/` if `'is greater than or equal to'` doesn't match a row in the current data.

- [ ] **Step 3: Run the test**

Run:

```bash
npx playwright test --project release-screenshots --grep "filter bar"
```

Expected: 1 passed.

- [ ] **Step 4: Eyeball the PNG**

Open `test/e2e/release-screenshots/output/filter-bar.png` and verify the filter bar shows the `age > 25` filter as an active chip/pill, the data grid is filtered to matching rows only, and no menu/popover is left open.

If the docs page wants a closeup of just the filter bar (not the full window), change `captureFullWindow` to `capturePanel(<filter-bar-locator>, 'filter-bar.png')`. The likely locator is `page.locator('.summary-row-filter-bar')` (see `test/e2e/pages/dataExplorer.ts:668`).

- [ ] **Step 5: Commit**

```bash
git add test/e2e/release-screenshots/filter-bar.screenshot.ts
git commit -m "feat(e2e): add release screenshot for Data Explorer filter bar"
```

---

## Task 9: Run all screenshot tests end-to-end

Final verification: run the whole project, confirm all 5 PNGs land cleanly.

- [ ] **Step 1: Wipe the output folder**

```bash
rm -f test/e2e/release-screenshots/output/*.png
```

- [ ] **Step 2: Run the full project**

```bash
npx playwright test --project release-screenshots
```

Expected: 5 passed (welcome, launch-positron, variables-pane, data-explorer, filter-bar). Total time: 2-5 minutes (interpreter startup dominates).

- [ ] **Step 3: Confirm all 5 PNGs are present**

```bash
ls test/e2e/release-screenshots/output/
```

Expected output (order may vary):

```
data-explorer.png
filter-bar.png
launch-positron.png
variables-pane.png
welcome.png
```

- [ ] **Step 4: Spot-check that nothing leaks into the regular e2e run**

```bash
npx playwright test --project e2e-electron --list | grep -c release-screenshots
```

Expected: `0`. (Confirms no `.screenshot.ts` file from the new folder is being picked up by `e2e-electron`.)

- [ ] **Step 5: Update the README so future contributors know this exists**

Append a short section to `test/e2e/README.md` describing the new project: what it's for, how to run it, where output lands, and the link to the spec at `docs/superpowers/specs/2026-04-30-release-screenshots-design.md`. Keep it tight (10-15 lines).

- [ ] **Step 6: Commit**

```bash
git add test/e2e/README.md
git commit -m "docs(e2e): document release-screenshots project"
```

---

## Out-of-scope reminders (do not implement here)

- Windows CI runner.
- GitHub Action that opens a PR against the docs repo.
- Coverage of the rest of the docs outline (~30+ pages).
- Annotated screenshots (data-explorer.html-style overlays).
- Visual regression / snapshot diffing.

These are phase-2 concerns. If you find yourself reaching for them mid-task, stop and confirm scope with the spec.
