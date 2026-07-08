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

const FIXTURE_REL_PATH = join('workspaces', 'quarto_inline_output', 'rawhtml_scroll.qmd');

// Line of the code cell that renders the widget, and a line far below it.
const CELL_LINE = 6;
const FAR_BELOW_LINE = 210;

// A Quarto document whose first cell renders an R htmlwidget (highcharter).
// htmlwidget output is self-contained HTML that Positron routes through the
// raw-HTML overlay webview -- the same rendering path as R's flextable output
// from the bug report -- as opposed to the widget/plot path used by Plotly. The
// filler paragraphs below let the output scroll far out of Monaco's rendered
// range. See the Plotly variant in quarto-inline-output-webview-scroll.test.ts
// for the widget-path counterpart.
function fixtureContent(): string {
	const filler = Array.from(
		{ length: 200 },
		(_, i) => `Line ${i + 1}: The quick brown fox jumps over the lazy dog while the webview stays anchored.`
	).join('\n');
	return `---
title: "Raw HTML Scroll Test"
engine: knitr
---

\`\`\`{r}
library(highcharter)
hchart(data.frame(x = 1:5, y = c(1, 4, 9, 16, 25)), "scatter", hcaes(x, y))
\`\`\`

## Filler section

${filler}
`;
}

test.describe('Quarto - Inline Output: Raw HTML scroll', {
	tag: [tags.QUARTO]
}, () => {

	test.beforeEach(async function ({ app }) {
		await fs.writeFile(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), fixtureContent(), 'utf8');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await fs.rm(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), { force: true });
	});

	// Regression test for posit-dev/positron#13978, raw-HTML overlay path. The
	// overlay must hide while its view zone is scrolled off-screen and reappear
	// when scrolled back, rather than "sticking" in the editor's top-left corner.
	test('R - Verify raw HTML output does not stick when scrolled out of view', async function ({ r, app, openFile, page }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab('rawhtml_scroll.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('rawhtml_scroll.qmd');
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();

		// The overlay webview appears once the htmlwidget renders.
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
