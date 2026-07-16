/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { promises as fs } from 'fs';
import { test, tags, expect } from './_test.setup';

test.use({
	suiteId: __filename
});

const FIXTURE_REL_PATH = join('workspaces', 'quarto_inline_output', 'rawhtml_persistence.qmd');

// Line of the code cell that renders the widget.
const CELL_LINE = 6;

// The escaped-text fallback shown when active HTML can't be routed to a webview.
// This is exactly what a restored htmlwidget regressed to before the fix, so its
// absence is the regression signal (posit-dev/positron#14559).
const WARNING_TEXT = 'Interactive HTML output (requires webview)';

// A Quarto document whose only cell renders an R htmlwidget (highcharter).
// htmlwidget output is self-contained HTML with <script> tags that Positron
// routes through the raw-HTML overlay webview -- the same path as the R HTML
// widgets in the bug report. This webview is built from the static HTML alone
// and needs no runtime session, so it must survive a close/reopen or window
// reload even before any kernel session reattaches.
function fixtureContent(): string {
	return `---
title: "Raw HTML Persistence Test"
engine: knitr
---

\`\`\`{r}
library(highcharter)
hchart(data.frame(x = 1:5, y = c(1, 4, 9, 16, 25)), "scatter", hcaes(x, y))
\`\`\`
`;
}

test.describe('Quarto - Inline Output: Raw HTML persistence', {
	tag: [tags.QUARTO]
}, () => {

	test.beforeEach(async function ({ app }) {
		await fs.writeFile(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), fixtureContent(), 'utf8');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await fs.rm(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), { force: true });
	});

	// Regression test for posit-dev/positron#14559. An R htmlwidget rendered as a
	// raw-HTML overlay webview must restore as a webview -- not the escaped-text
	// warning -- when the document is closed and reopened, since the cached output
	// is rehydrated before any kernel session reattaches.
	test('R - Verify raw HTML output restores as a webview after close and reopen', async function ({ r, app, openFile, page, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;
		const webview = page.locator('iframe.webview');

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('rawhtml_persistence.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell; the overlay webview appears once the htmlwidget renders.
		await editors.clickTab('rawhtml_persistence.qmd');
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();
		await expect(webview.first()).toBeVisible({ timeout: 120000 });

		// Close and reopen the document. The cached output rehydrates without a
		// session; it must come back as a webview, not the raw-HTML warning.
		await hotKeys.closeAllEditors();
		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('rawhtml_persistence.qmd');

		await inlineQuarto.gotoLine(CELL_LINE);
		await expect(webview.first()).toBeVisible({ timeout: 60000 });
		await expect(page.getByText(WARNING_TEXT)).not.toBeVisible();
	});

	// Same regression, exercised via a full window reload rather than an editor
	// close/reopen. Moved after the close/reopen case since a reload can destabilize
	// subsequent tests.
	test('R - Verify raw HTML output restores as a webview after window reload', async function ({ r, app, openFile, page, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;
		const webview = page.locator('iframe.webview');

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('rawhtml_persistence.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('rawhtml_persistence.qmd');
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();
		await expect(webview.first()).toBeVisible({ timeout: 120000 });

		// Reloading the window triggers a graceful shutdown, which flushes the
		// output cache to disk (the service joins flushAll() on onWillShutdown),
		// so the debounced write can't race the reload -- no wait is needed.
		// Reload the window; the cached output rehydrates as the editor restores.
		await hotKeys.reloadWindow(true);
		await editors.waitForActiveTab('rawhtml_persistence.qmd');

		await inlineQuarto.gotoLine(CELL_LINE);
		await expect(webview.first()).toBeVisible({ timeout: 60000 });
		await expect(page.getByText(WARNING_TEXT)).not.toBeVisible();
	});
});
