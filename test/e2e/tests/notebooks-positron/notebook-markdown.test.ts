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

	test('Should be able to create and render a markdown cell', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('R');
		await notebooksPositron.expectCellCountToBe(1);
		await hotKeys.notebookLayout();

		// Verify can create markdown cell
		await notebooksPositron.clickActionBarButtton('Markdown');
		await notebooksPositron.expectCellCountToBe(2);
		await notebooksPositron.expectCellTypeAtIndexToBe(1, 'markdown');

		// Add markdown content to cell and render
		const markdownContent = '# Heading 1\n\n## Heading 2\n\n**Bold Text**\n\n*Italic Text*';
		await notebooksPositron.addCodeToCell(1, markdownContent);
		await notebooksPositron.clickActionBarButtton('Run All');

		// Verify markdown rendered correctly
		await notebooksPositron.assertMarkdownText('h1', 'Heading 1');
		await notebooksPositron.assertMarkdownText('h2', 'Heading 2');
		await notebooksPositron.assertMarkdownText('strong', 'Bold Text');
		await notebooksPositron.assertMarkdownText('em', 'Italic Text');
		await notebooksPositron.expectScreenshotMatchAtIndex(1, 'basic-markdown-render.png');
	});
});
