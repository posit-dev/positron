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

test.describe('Positron Notebooks: Markdown Hyperlink Anchoring', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('markdown hyperlink anchors should navigate within notebook, not open file browser', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;

		// Create a new notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.expectCellCountToBe(1);

		// Add markdown cell at the top with an anchor
		await notebooksPositron.addCell('markdown');
		await notebooksPositron.expectCellCountToBe(2);

		const anchorMarkdown = '# Section 1\n<a id="anchor"></a>\nThis is the anchored section.';
		await notebooksPositron.addCodeToCell(1, anchorMarkdown);

		// Render the markdown
		await notebooksPositron.viewMarkdown.click();

		// Verify markdown is rendered
		await notebooksPositron.expectMarkdownTagToBe('h1', 'Section 1');

		// Add several cells in between to create distance
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(2, '# Cell 2');
		await notebooksPositron.expectCellCountToBe(3);

		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(3, '# Cell 3');
		await notebooksPositron.expectCellCountToBe(4);

		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(4, '# Cell 4');
		await notebooksPositron.expectCellCountToBe(5);

		// Add markdown cell at the bottom with a hyperlink to the anchor
		await notebooksPositron.addCell('markdown');
		await notebooksPositron.expectCellCountToBe(6);

		const linkMarkdown = '[Jump to Section 1](#anchor)';
		await notebooksPositron.addCodeToCell(5, linkMarkdown);

		// Render the markdown
		await notebooksPositron.viewMarkdown.click();

		// Verify the link is rendered
		const linkLocator = page.locator('a[href="#anchor"]');
		await expect(linkLocator).toBeVisible();

		// Click the hyperlink
		await linkLocator.click();

		// Assert: No error dialog should appear
		const errorDialog = page.getByText(/Unable to open/i);
		await expect(errorDialog).not.toBeVisible({ timeout: 2000 });

		// Assert: No file browser should open
		const folderDialog = page.getByText(/Open Folder/i);
		await expect(folderDialog).not.toBeVisible({ timeout: 2000 });
	});

	test('markdown hyperlink anchors with name attribute should work', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;

		// Create a new notebook
		await notebooksPositron.newNotebook();

		// Add markdown cell with name attribute anchor
		await notebooksPositron.addCell('markdown');
		const anchorMarkdown = '# Important Section\n<a name="important"></a>\nContent here.';
		await notebooksPositron.addCodeToCell(1, anchorMarkdown);
		await notebooksPositron.viewMarkdown.click();

		// Add some cells in between
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(2, '# Spacer Cell 1');

		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(3, '# Spacer Cell 2');

		// Add markdown cell with link to name anchor
		await notebooksPositron.addCell('markdown');
		const linkMarkdown = '[Go to Important Section](#important)';
		await notebooksPositron.addCodeToCell(4, linkMarkdown);
		await notebooksPositron.viewMarkdown.click();

		// Verify link is rendered
		const linkLocator = page.locator('a[href="#important"]');
		await expect(linkLocator).toBeVisible();

		// Click the link
		await linkLocator.click();

		// Assert: No error dialogs should appear
		const errorDialog = page.getByText(/Unable to open/i);
		await expect(errorDialog).not.toBeVisible({ timeout: 2000 });
	});

	test('multiple anchor links in same notebook should work independently', async function ({ app, page }) {
		const { notebooksPositron } = app.workbench;

		// Create a new notebook
		await notebooksPositron.newNotebook();

		// Add first markdown cell with anchor
		await notebooksPositron.addCell('markdown');
		await notebooksPositron.addCodeToCell(1, '# Section A\n<a id="section-a"></a>');
		await notebooksPositron.viewMarkdown.click();

		// Add spacing cell
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(2, '# Spacer');

		// Add second markdown cell with anchor
		await notebooksPositron.addCell('markdown');
		await notebooksPositron.addCodeToCell(3, '# Section B\n<a id="section-b"></a>');
		await notebooksPositron.viewMarkdown.click();

		// Add spacing cell
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(4, '# Spacer 2');

		// Add markdown cell with links to both anchors
		await notebooksPositron.addCell('markdown');
		const linksMarkdown = '[Go to A](#section-a) | [Go to B](#section-b)';
		await notebooksPositron.addCodeToCell(5, linksMarkdown);
		await notebooksPositron.viewMarkdown.click();

		// Test link to section B
		const linkBLocator = page.locator('a[href="#section-b"]');
		await expect(linkBLocator).toBeVisible();
		await linkBLocator.click();

		// Verify no errors
		const errorDialog = page.getByText(/Unable to open/i);
		await expect(errorDialog).not.toBeVisible({ timeout: 2000 });

		// Test link to section A
		const linkALocator = page.locator('a[href="#section-a"]');
		await expect(linkALocator).toBeVisible();
		await linkALocator.click();

		// Verify no errors
		await expect(errorDialog).not.toBeVisible({ timeout: 2000 });
	});
});
