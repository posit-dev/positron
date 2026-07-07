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

// Relative path (from the workspace root) of the fixture we generate at runtime.
const FIXTURE_REL_PATH = join('workspaces', 'quarto_inline_output', 'webview_scroll.qmd');

// Line of the code cell that renders the webview, and a line far below it.
const CELL_LINE = 11;
const FAR_BELOW_LINE = 210;

// A Quarto document whose first cell renders an interactive Plotly figure (an
// overlay webview) followed by enough filler text that the output can be
// scrolled far out of Monaco's rendered range. Plotly is used (rather than the
// R packages from the bug report) because the sticking is a property of the
// webview-overlay anchoring and is language-agnostic, and Python/ipykernel runs
// reliably in local dev and CI.
function fixtureContent(): string {
	const filler = Array.from(
		{ length: 200 },
		(_, i) => `Line ${i + 1}: The quick brown fox jumps over the lazy dog while the webview stays anchored.`
	).join('\n');
	return `---
title: "Webview Scroll Test"
jupyter: python3
---

An interactive Plotly figure is rendered inline as a webview overlay. The
paragraphs below exist so the output can be scrolled far out of view.

\`\`\`{python}
import plotly.express as px
fig = px.scatter(x=[0, 1, 2, 3, 4], y=[0, 1, 4, 9, 16])
fig.show()
\`\`\`

## Filler section

${filler}
`;
}

test.describe('Quarto - Inline Output: Webview scroll', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeEach(async function ({ app }) {
		await fs.writeFile(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), fixtureContent(), 'utf8');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await fs.rm(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), { force: true });
	});

	// Regression test for posit-dev/positron#13978: an inline-output webview is a
	// fixed-position overlay anchored to a placeholder inside the editor view
	// zone. When the placeholder scrolls out of Monaco's rendered range it
	// collapses to zero layout boxes, and the overlay used to fall back to a
	// static position and "stick" in the editor's top-left corner. It must hide
	// while its anchor is off-screen and reappear when scrolled back.
	test('Python - Verify webview output does not stick when scrolled out of view', async function ({ python, app, openFile, page }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('webview_scroll.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('webview_scroll.qmd');
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();

		// The overlay webview appears once the Plotly figure renders.
		const webview = page.locator('iframe.webview');
		await expect(webview.first()).toBeVisible({ timeout: 120000 });

		// Scroll far past the output so its view zone leaves the rendered range.
		// The overlay must not remain visible (it used to stick in the corner).
		await inlineQuarto.gotoLine(FAR_BELOW_LINE);
		await expect(webview.first()).not.toBeVisible();

		// Scrolling back to the cell must bring the overlay back.
		await inlineQuarto.gotoLine(CELL_LINE);
		await expect(webview.first()).toBeVisible();
	});
});
