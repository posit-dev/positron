/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Outline', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.OUTLINE]
}, () => {

	test('Outline displays markdown headers from notebook cells', async function ({ app, hotKeys }) {
		const { notebooksPositron, outline } = app.workbench;

		await test.step('Create notebook with markdown header cells', async () => {
			await notebooksPositron.newNotebook();
			await hotKeys.notebookLayout();

			// Add a markdown cell with a level-1 header
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(1, '# Introduction');

			// Add a code cell between the markdown cells
			await notebooksPositron.addCodeToCell(2, 'x = 1');

			// Add another markdown cell with a level-2 header
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(3, '## Analysis');
		});

		await test.step('Open Outline pane and verify entries', async () => {
			await outline.focus();

			// The outline should contain entries for each markdown header
			await outline.expectOutlineElementToBeVisible('Introduction');
			await outline.expectOutlineElementToBeVisible('Analysis');
		});
	});

	test('Clicking an outline entry navigates to the corresponding cell', async function ({ app, hotKeys }) {
		const { notebooksPositron, outline } = app.workbench;

		await test.step('Create notebook with multiple markdown header cells', async () => {
			await notebooksPositron.newNotebook();
			await hotKeys.notebookLayout();

			// Cell 0: default empty code cell (from newNotebook)
			// Cell 1: markdown header "# First Section"
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(1, '# First Section');

			// Cell 2: code cell
			await notebooksPositron.addCodeToCell(2, 'x = 1');

			// Cell 3: code cell
			await notebooksPositron.addCodeToCell(3, 'y = 2');

			// Cell 4: markdown header "# Second Section"
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(4, '# Second Section');

			// Cell 5: code cell
			await notebooksPositron.addCodeToCell(5, 'z = 3');
		});

		await test.step('Open Outline and click second header entry', async () => {
			await outline.focus();

			// Verify both headers appear in the outline
			await outline.expectOutlineElementToBeVisible('First Section');
			await outline.expectOutlineElementToBeVisible('Second Section');

			// Click the "Second Section" entry to navigate
			const secondSectionEntry = outline.outlineElement.filter({ hasText: 'Second Section' });
			await secondSectionEntry.click();
		});

		await test.step('Verify notebook navigated to the correct cell', async () => {
			// After clicking "Second Section" in the outline, the notebook
			// should select cell 4 (the markdown cell with "# Second Section")
			await notebooksPositron.expectCellIndexToBeSelected(4, { isSelected: true });
		});
	});
});
