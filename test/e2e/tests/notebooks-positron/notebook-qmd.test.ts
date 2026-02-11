/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.beforeAll(async function ({ settings }) {
	// Make the Positron notebook editor the default for .qmd files
	await settings.set({
		'workbench.editorAssociations': { '*.qmd': 'workbench.editor.positronNotebook' },
	});
});

test.describe('Positron Notebooks: .qmd Support', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.QUARTO]
}, () => {

	test('Can open a .qmd file in the Positron notebook editor', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Open the .qmd file
		await notebooksPositron.openNotebook('workspaces/quarto_basic/quarto_basic.qmd');

		// Check parsed cells
		await notebooksPositron.expectCellCountToBe(4);

		// 1. Frontmatter
		await notebooksPositron.expectCellTypeAtIndexToBe(0, 'raw');
		await notebooksPositron.expectCellContentAtIndexToBe(0, [
			'---',
			'title: "Diamond sizes"',
			'date: 2022-09-12',
			'format: html',
			'---',
		]);

		// 2. R code cell with setup
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'code');
		await notebooksPositron.expectCellContentAtIndexToBe(1, [
			'#| label: setup',
			'#| include: false',
			'',
			'library(tidyverse)',
			'',
			'smaller <- diamonds |> ',
			'  filter(carat <= 2.5)',
		]);

		// 3. Markdown cell
		await notebooksPositron.expectCellTypeAtIndexToBe(2, 'markdown');
		await notebooksPositron.expectCellContentAtIndexToBe(2, [
			'We have data about `r nrow(diamonds)` diamonds.',
			'Only `r nrow(diamonds) - nrow(smaller)` are larger than 2.5 ',
			'carats.',
			'The distribution of the remainder is shown below:',
		]);

		// 4. R code cell with plot
		await notebooksPositron.expectCellTypeAtIndexToBe(3, 'code');
		await notebooksPositron.expectCellContentAtIndexToBe(3, [
			'#| label: plot-smaller-diamonds',
			'#| echo: false',
			'',
			'smaller |> ',
			'  ggplot(aes(x = carat)) + ',
			'  geom_freqpoly(binwidth = 0.01)',
		]);
	});

	test.skip('Can edit and save a .qmd file in the Positron notebook editor', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Open the .qmd file
		await notebooksPositron.openNotebook('workspaces/quarto_basic/quarto_basic.qmd');

		// Verify cells were parsed from the .qmd content
		await notebooksPositron.expectCellCountToBe(4);

		await notebooksPositron.editModeAtIndex(3);
		const editor = notebooksPositron.editorAtIndex(3);
		await editor.focus();
		editor.press('End');
	});
});
