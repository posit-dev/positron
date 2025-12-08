/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Markdown Cells', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async ({ app, settings }) => {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('ensure markdown cell can be created, rendered, and previewed', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// create notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.expectCellCountToBe(1);
		await hotKeys.notebookLayout();

		// verify can create markdown cell
		await notebooksPositron.clickActionBarButtton('Markdown');
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'markdown');

		// add markdown content to cell and render
		const markdownContent = '# Heading 1\n\n## Heading 2\n\n**Bold Text**\n\n*Italic Text*';
		await notebooksPositron.addCodeToCell(1, markdownContent);

		await notebooksPositron.viewMarkdown.click();
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });

		// verify markdown rendered correctly
		await notebooksPositron.expectMarkdownTagToBe('h1', 'Heading 1');
		await notebooksPositron.expectMarkdownTagToBe('h2', 'Heading 2');
		await notebooksPositron.expectMarkdownTagToBe('strong', 'Bold Text');
		await notebooksPositron.expectMarkdownTagToBe('em', 'Italic Text');
		await notebooksPositron.expectScreenshotToMatch(1, 'basic-markdown-render.png');
	});

	test('ensure markdown cell can switch between edit and preview modes', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// create notebook and add markdown cell
		await notebooksPositron.newNotebook();
		await notebooksPositron.clickActionBarButtton('Markdown');

		// verify markdown cell created and in edit mode
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });

		// add markdown content to cell
		await notebooksPositron.addCodeToCell(1, 'This is **bold** and this is *italic*');
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });

		// switch to preview mode and verify
		await notebooksPositron.viewMarkdown.click();
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: false });
		await notebooksPositron.expectMarkdownTagToBe('strong', 'bold');
		await notebooksPositron.expectMarkdownTagToBe('em', 'italic');

		// switch back to edit mode and verify
		await notebooksPositron.expandMarkdownEditor.click();
		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });
	});
});
