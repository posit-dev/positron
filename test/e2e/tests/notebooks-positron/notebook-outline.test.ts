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

	test('Outline displays markdown headers from notebook cells', async function ({ app }) {
		const { notebooksPositron, outline } = app.workbench;

		await test.step('Create notebook with markdown header cell', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(1, '# Introduction\n## Analysis');
		});

		await test.step('Open Outline pane and verify entries', async () => {
			await outline.focus();
			await outline.expectOutlineElementToBeVisible('Introduction');
			await outline.expectOutlineElementToBeVisible('Analysis');
		});
	});

	test('Clicking an outline entry navigates to the corresponding cell', async function ({ app }) {
		const { notebooksPositron, outline } = app.workbench;

		await test.step('Create notebook with multiple sections', async () => {
			await notebooksPositron.newNotebook();

			// Cell 1: markdown with "# First Section"
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(1, '# First Section');

			// Cell 2: code cell
			await notebooksPositron.addCell('code');
			await notebooksPositron.addCodeToCell(2, 'x = 1');

			// Cell 3: markdown with "# Second Section"
			await notebooksPositron.addCell('markdown');
			await notebooksPositron.addCodeToCell(3, '# Second Section');
		});

		await test.step('Open Outline and click second header entry', async () => {
			await outline.focus();
			await outline.expectOutlineElementToBeVisible('First Section');
			await outline.expectOutlineElementToBeVisible('Second Section');

			// Click the "Second Section" entry to navigate
			const secondSectionEntry = outline.outlineElement.filter({ hasText: 'Second Section' });
			await secondSectionEntry.click();
		});

		await test.step('Verify notebook navigated to the correct cell', async () => {
			// After clicking "Second Section" in the outline, the notebook
			// should select cell 3 (the markdown cell with "# Second Section")
			await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: true });
		});
	});
});
