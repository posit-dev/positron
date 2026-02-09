/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Enable plain text notebook support and associate .qmd files with
// the Positron notebook editor
test.beforeAll(async function ({ settings }) {
	await settings.set({
		'positron.notebook.plainText.enable': true,
		'workbench.editorAssociations': { '*.qmd': 'workbench.editor.positronNotebook' },
	});
});

test.describe('Positron Notebooks: QMD Files', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.QUARTO]
}, () => {

	test('Can open a .qmd file in the Positron notebook editor', async function ({ app, openFile }) {
		const { notebooksPositron, editors } = app.workbench;
		const page = app.code.driver.page;

		// Open the .qmd file (skip waitForFocus since notebook editors don't
		// have a focusable Monaco text editor)
		await openFile('workspaces/quarto_basic/quarto_basic.qmd', false);

		// Race: wait for either the notebook to appear or an editor error
		const notebook = page.locator('.positron-notebook').first();
		const editorError = page.getByText('The editor could not be opened');
		const result = await Promise.race([
			notebook.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'notebook' as const),
			editorError.waitFor({ state: 'visible', timeout: 15000 }).then(() => 'error' as const),
		]).catch(() => 'timeout' as const);

		if (result === 'timeout') {
			// Neither appeared — dump page content for debugging
			const bodyText = await page.locator('body').innerText();
			throw new Error(`Neither the Positron notebook nor an editor error appeared within 15s.\nPage text:\n${bodyText.substring(0, 2000)}`);
		}

		// Fail immediately with a clear message if the editor errored
		expect(result, 'Expected the Positron notebook editor to open, but got an editor error instead. ' +
			'Check the Positron logs for details.').toBe('notebook');

		// Verify the active tab shows the .qmd file
		await editors.waitForActiveTab('quarto_basic.qmd', false);

		// Verify cells were parsed from the .qmd content:
		// 1. YAML frontmatter cell
		// 2. R code cell (setup)
		// 3. Markdown cell (diamond sizes text)
		// 4. R code cell (plot)
		await notebooksPositron.expectCellCountToBe(4);

		// Verify the first code cell contains the expected R code
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'code');
		await notebooksPositron.expectCellContentAtIndexToBe(1, [
			'#| label: setup',
			'#| include: false',
			'',
			'library(tidyverse)',
			'',
			'smaller <- diamonds |>',
			'  filter(carat <= 2.5)',
		]);
	});
});
