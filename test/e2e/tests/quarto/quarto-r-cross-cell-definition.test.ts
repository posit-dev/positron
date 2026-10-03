/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from './_test.setup';

test.use({
	suiteId: __filename
});

// Ark resolves names in a chunk against the chunks above it, which it only
// can do when it gets the document's chunks in order as a notebook.
test.describe('Quarto - R Cross-Chunk Go to Definition', { tag: [tags.QUARTO, tags.ARK, tags.WEB, tags.WIN] }, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Go to Definition in an R chunk lands on a definition in an earlier chunk', async function ({ app, page, r, openFile }) {
		const fileName = 'cross_cell_definition.qmd';
		const { editor, editors, inlineQuarto } = app.workbench;

		await openFile(join('workspaces', 'cross_cell_definition', fileName));
		await editors.waitForActiveTab(fileName);

		// Retry until Ark has the chunks: before that, F12 finds no definition.
		await expect(async () => {
			// `my_r_helper(21)` in the second chunk, cursor on its first column.
			await inlineQuarto.gotoLine(12);
			await page.keyboard.press('F12');
			// `my_r_helper <- function(x) {` in the first chunk.
			await editor.expectActiveLineNumber(fileName, 6);
		}).toPass({ timeout: 60000 });
	});
});
