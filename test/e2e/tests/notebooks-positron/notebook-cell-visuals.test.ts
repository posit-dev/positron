/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Cell Visual Snapshots', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Code cells with footer and output - all states', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await notebooks.createNewNotebook();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'print("Hello World")', { run: true });
		await notebooksPositron.addCodeToCell(1, '# Second cell', { run: false });

		await test.step('Selected state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-output-selected.png');
		});

		await test.step('Editing state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: true });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-output-editing.png');
		});

		await test.step('Default state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-output-default.png');
		});

		await test.step('Hovered state', async () => {
			await notebooksPositron.cell.nth(0).hover();
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-output-hovered.png');
		});
	});

	test('Code cells with footer and no output - all states', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await notebooks.createNewNotebook();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'x = 42', { run: true });
		await notebooksPositron.addCodeToCell(1, '# Second cell', { run: false });

		await test.step('Default state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-no-output-default.png');
		});

		await test.step('Hovered state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.cell.nth(0).hover();
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-no-output-hovered.png');
		});

		await test.step('Editing state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: true });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-no-output-editing.png');
		});

		await test.step('Selected state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-with-footer-no-output-selected.png');
		});
	});

	test('Code cells never executed - all states', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'print("Not executed")', { run: false });
		await notebooksPositron.addCodeToCell(1, '# Second cell', { run: false });

		await test.step('Default state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-never-executed-default.png');
		});

		await test.step('Hovered state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.cell.nth(0).hover();
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-never-executed-hovered.png');
		});

		await test.step('Editing state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: true });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-never-executed-editing.png');
		});

		await test.step('Selected state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-never-executed-selected.png');
		});
	});

	test('Markdown cells rendered - all states', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await hotKeys.notebookLayout();
		await notebooksPositron.clickActionBarButtton('Markdown');

		const markdownContent = '# Heading 1\n\n## Heading 2\n\n**Bold** and *Italic*';
		await notebooksPositron.addCodeToCell(1, markdownContent);
		await notebooksPositron.viewMarkdown.click();

		await test.step('Default state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(1, 'markdown-cell-rendered-default.png');
		});

		await test.step('Hovered state', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await notebooksPositron.cell.nth(1).hover();
			await notebooksPositron.expectScreenshotToMatch(1, 'markdown-cell-rendered-hovered.png');
		});

		await test.step('Selected state', async () => {
			await notebooksPositron.selectCellAtIndex(1, { editMode: false });
			await notebooksPositron.expectScreenshotToMatch(1, 'markdown-cell-rendered-selected.png');
		});
	});

	test('Markdown cell editing state', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await hotKeys.notebookLayout();
		await notebooksPositron.clickActionBarButtton('Markdown');

		const markdownContent = '# Heading 1\n\n## Heading 2\n\n**Bold** and *Italic*';
		await notebooksPositron.addCodeToCell(1, markdownContent);

		await notebooksPositron.expectCellIndexToBeSelected(1, { inEditMode: true });
		await notebooksPositron.expectScreenshotToMatch(1, 'markdown-cell-editing.png');
	});

	test('Code cell error output state', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await notebooks.createNewNotebook();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'raise Exception("Test error")', { run: true });

		await notebooksPositron.selectCellAtIndex(0, { editMode: false });
		await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-error-output.png');
	});

	test('Code cell running state', async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;

		await notebooks.createNewNotebook();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, 'import time; time.sleep(5)', { run: true });

		await notebooksPositron.expectSpinnerAtIndex(0, true);
		await notebooksPositron.expectScreenshotToMatch(0, 'code-cell-running.png');

		await notebooksPositron.expectSpinnerAtIndex(0, false);
	});
});
