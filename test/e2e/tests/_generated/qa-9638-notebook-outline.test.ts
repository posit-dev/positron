/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA #9638: Outline shows markdown headers and code cell previews with nesting', async function ({ app }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with nested headers and code
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCodeToCell(0, 'x = 42');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, '# Introduction\n## Analysis\n### Details');

	// Verify outline entries with proper nesting
	await outline.focus();
	await outline.expectOutlineElementToBeVisible('Introduction');
	await outline.expectOutlineElementToBeVisible('Analysis');
	await outline.expectOutlineElementToBeVisible('Details');
	await outline.expectOutlineElementToBeVisible('x = 42');
});

test('QA #9638: Clicking outline entries navigates to corresponding cells', async function ({ app }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with multiple sections
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCodeToCell(0, 'x = 42');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, '# Introduction');
	await notebooksPositron.addCell('code');
	await notebooksPositron.addCodeToCell(2, 'y = 100');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(3, '# Second Section');

	// Click outline entries and verify cell navigation
	await outline.focus();
	const secondSection = outline.outlineElement.filter({ hasText: 'Second Section' });
	await secondSection.click();
	await notebooksPositron.expectCellIndexToBeSelected(3, { isSelected: true });

	const codeEntry = outline.outlineElement.filter({ hasText: 'x = 42' });
	await codeEntry.click();
	await notebooksPositron.expectCellIndexToBeSelected(0, { isSelected: true });

	const yEntry = outline.outlineElement.filter({ hasText: 'y = 100' });
	await yEntry.click();
	await notebooksPositron.expectCellIndexToBeSelected(2, { isSelected: true });
});

test('QA #9638: Outline updates when cell content is edited', async function ({ app, page }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with a markdown header
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCodeToCell(0, 'x = 1');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, '# Original Title');

	await outline.focus();
	await outline.expectOutlineElementToBeVisible('Original Title');

	// Edit the markdown cell content
	await notebooksPositron.selectCellAtIndex(1, { editMode: true });
	await page.keyboard.press('Meta+a');
	await page.keyboard.type('# Updated Title\n## New Subsection', { delay: 10 });
	await notebooksPositron.clickAwayFromCell(1);

	// Verify outline refreshes with updated content
	await outline.focus();
	await outline.expectOutlineElementToBeVisible('Updated Title');
	await outline.expectOutlineElementToBeVisible('New Subsection');
	await outline.expectOutlineElementToBeVisible('Original Title', false);
});

test('QA #9638: Outline handles empty cells and plain markdown', async function ({ app }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with an empty code cell and plain markdown
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, 'plain text no headers');

	// Verify edge case entries
	await outline.focus();
	await outline.expectOutlineElementToBeVisible('empty cell');
	await outline.expectOutlineElementToBeVisible('plain text no headers');
});

test('QA #9638: Outline handles duplicate headings', async function ({ app }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with duplicate heading text
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCodeToCell(0, 'z = 999');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, '# Data\n## Summary\n# Data');

	// Verify both duplicate headers appear
	await outline.focus();
	await outline.expectOutlineToContain(['Data', 'Summary', 'Data']);
	await outline.expectOutlineElementToBeVisible('z = 999');
});

test('QA #9638: Outline updates when cells are added and deleted', async function ({ app }) {
	const { notebooksPositron, outline } = app.workbench;

	// Create notebook with initial cells
	await notebooksPositron.newNotebook();
	await notebooksPositron.addCodeToCell(0, 'z = 999');
	await notebooksPositron.addCell('markdown');
	await notebooksPositron.addCodeToCell(1, '# Data\n## Summary');

	await outline.focus();
	await outline.expectOutlineElementCountToBe(3);

	// Add a new cell and verify outline gains entry
	await notebooksPositron.addCell('code');
	await notebooksPositron.addCodeToCell(2, 'new_var = 1');
	await outline.focus();
	await outline.expectOutlineElementCountToBe(4);

	// Delete a cell and verify outline loses entry
	await notebooksPositron.selectCellAtIndex(0);
	await notebooksPositron.deleteCellWithActionBar(0);
	await outline.focus();
	await outline.expectOutlineElementToBeVisible('z = 999', false);
	await outline.expectOutlineElementCountToBe(3);
});
