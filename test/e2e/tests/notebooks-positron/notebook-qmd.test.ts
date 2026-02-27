/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

const QUARTO_BASIC_PATH = 'workspaces/quarto_basic/quarto_basic.qmd';

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

	test('Can open a .qmd file and perform cell actions', async function ({ app }) {
		// Single test that .qmd files parse correctly into a notebook
		// Extensive checks are handled in unit tests in the positronQuartoNotebook contribution

		const { notebooksPositron } = app.workbench;

		// Open the .qmd file
		await notebooksPositron.openNotebook(QUARTO_BASIC_PATH);

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
		// getCellContent returns visually wrapped lines whose boundaries depend on
		// editor width, so join into a single string for comparison.
		await notebooksPositron.expectCellTypeAtIndexToBe(2, 'markdown');
		const markdownContent = (await notebooksPositron.getCellContent(2)).join('');
		expect(markdownContent).toContain('We have data about `r nrow(diamonds)` diamonds.');
		expect(markdownContent).toContain('Only `r nrow(diamonds) - nrow(smaller)` are larger than 2.5 carats.');
		expect(markdownContent).toContain('The distribution of the remainder is shown below:');

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

		// Run the first code cell and check output
		await notebooksPositron.kernel.select('R');
		await notebooksPositron.runCodeAtIndex(1);
		await notebooksPositron.expectOutputAtIndex(1, ['── Attaching']);
	});

	test('Can edit and save a .qmd file', async function ({ app, hotKeys }) {
		// Single test that .qmd files can be edited and saved in the notebook editor
		// Extensive checks are handled in unit tests in the positronQuartoNotebook contribution

		const { notebooksPositron } = app.workbench;

		const content = ['---', 'title: new title', '---'];

		// Open the .qmd file
		await notebooksPositron.openNotebook(QUARTO_BASIC_PATH);
		await notebooksPositron.expectCellCountToBe(4);

		// Edit the frontmatter cell and save
		await notebooksPositron.editModeAtIndex(0);
		const editor = notebooksPositron.editorAtIndex(0);
		await hotKeys.selectAll();
		await editor.pressSequentially(content.join('\n'));
		await hotKeys.save();
		await hotKeys.closeTab();

		// Open it again and check that our edits were saved and parsed correctly
		await notebooksPositron.openNotebook(QUARTO_BASIC_PATH);
		await notebooksPositron.expectCellCountToBe(4);
		await notebooksPositron.expectCellContentAtIndexToBe(0, content);
	});
});
