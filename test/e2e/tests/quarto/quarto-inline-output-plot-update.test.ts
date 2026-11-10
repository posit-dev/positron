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

const FILE_NAME = 'plot_update.qmd';
const FIXTURE_REL_PATH = join('workspaces', 'quarto_inline_output', FILE_NAME);

// Line of the code cell that draws the plot.
const CELL_LINE = 7;

// An R chunk that draws an empty plot, then fills the whole plot region red
// with a low-level call. Ark sends the empty plot as `display_data` and the
// red fill as `update_display_data` with the same display ID.
function fixtureContent(): string {
	return `---
title: "Plot Update Test"
engine: knitr
---

\`\`\`{r}
par(mar = c(0, 0, 0, 0))
plot(1, type = "n", axes = FALSE, ann = FALSE, xlim = c(0, 1), ylim = c(0, 1))
rect(0, 0, 1, 1, col = "red", border = NA)
\`\`\`
`;
}

test.describe('Quarto - Inline Output: Plot Updates', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO, tags.ARK]
}, () => {

	test.beforeEach(async function ({ app }) {
		await fs.writeFile(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), fixtureContent(), 'utf8');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await fs.rm(join(app.workspacePathOrFolder, FIXTURE_REL_PATH), { force: true });
	});

	// Regression test for posit-dev/positron#15544. A low-level plot call after
	// a high-level one arrives as `update_display_data`; inline output must show
	// the updated plot, not the first (empty) snapshot.
	test('R - Verify a low-level plot call updates the inline plot', async function ({ r, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(FIXTURE_REL_PATH);
		await editors.waitForActiveTab(FILE_NAME);
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab(FILE_NAME);
		await inlineQuarto.gotoLine(CELL_LINE);
		await inlineQuarto.runCurrentCell();

		// One plot, replaced in place, showing the red fill from rect().
		await expect(inlineQuarto.imageOutput).toHaveCount(1, { timeout: 60000 });
		await inlineQuarto.expectImageCenterColor([255, 0, 0]);
		await expect(inlineQuarto.imageOutput).toHaveCount(1);
	});
});
