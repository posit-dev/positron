/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: DataFrame and Interactive HTML', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test('Python - Verify DataFrame output shows HTML only, not duplicate text and HTML', async function ({ python, app, openFile, settings }) {
		const { editors, inlineQuarto } = app.workbench;

		// Disable inline data explorer so DataFrame falls back to HTML rendering
		await settings.set({
			'positron.notebook.inlineDataExplorer.enabled': false
		});

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'py_data_frame.qmd'));
		await editors.waitForActiveTab('py_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('py_data_frame.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await inlineQuarto.expectOutputVisible();

		// Verify exactly one output item (no duplicates)
		await inlineQuarto.expectOutputsExist(1);

		// Verify HTML output present
		await inlineQuarto.expectHtmlOutputVisible();

		// Verify no duplicate text output
		await inlineQuarto.expectStdoutNotContains(['col1', 'col2']);

		// Verify no data explorer metadata leaked
		await inlineQuarto.expectNoDataExplorerMetadata();

		// Re-enable inline data explorer
		await settings.set({
			'positron.notebook.inlineDataExplorer.enabled': true
		});
	});

	test('Python - Verify DataFrame shows inline data explorer', {
		tag: [tags.DATA_EXPLORER]
	}, async function ({ python, app, openFile }) {
		const { editors, inlineQuarto, inlineDataExplorer } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'py_data_frame.qmd'));
		await editors.waitForActiveTab('py_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('py_data_frame.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 7, outputLine: 12 });
		await inlineQuarto.expectOutputVisible();

		// Verify inline data explorer appears
		await inlineDataExplorer.expectToBeVisible();
		await inlineDataExplorer.expectGridToBeReady();

		// Verify shape and column headers
		await inlineDataExplorer.expectShapeToContain(3, 2);
		await inlineDataExplorer.expectColumnHeaderToBeVisible('Name');
		await inlineDataExplorer.expectColumnHeaderToBeVisible('Age');

		// Verify data content
		await inlineDataExplorer.expectCellValue('Name', 0, 'Alice');
	});

	test('R - Verify DataFrame shows inline data explorer', {
		tag: [tags.DATA_EXPLORER]
	}, async function ({ r, app, openFile }) {
		const { editors, inlineQuarto, inlineDataExplorer } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'r_data_frame.qmd'));
		await editors.waitForActiveTab('r_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('r_data_frame.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 7, outputLine: 20 });
		await inlineQuarto.expectOutputVisible();

		// Verify inline data explorer appears
		await inlineDataExplorer.expectToBeVisible();
		await inlineDataExplorer.expectGridToBeReady();

		// Verify shape and column headers
		await inlineDataExplorer.expectShapeToContain(3, 2);
		await inlineDataExplorer.expectColumnHeaderToBeVisible('Name');
		await inlineDataExplorer.expectColumnHeaderToBeVisible('Age');

		// Verify data content
		await inlineDataExplorer.expectCellValue('Name', 0, 'Alice');
	});

	test('Python - Verify interactive HTML widget persists correctly after close and reopen', async function ({ python, app, openFile, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;

		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('interactive_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await inlineQuarto.expectOutputVisible();

		// Verify webview/HTML output
		await inlineQuarto.expectWebviewOrHtmlVisible();

		// Close and reopen
		await hotKeys.closeAllEditors();
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');

		// Verify output persisted
		await inlineQuarto.gotoLine(15);
		await inlineQuarto.expectOutputVisible();
		await inlineQuarto.expectWebviewOrHtmlVisible();

		// Verify no JSON blob
		await inlineQuarto.expectStdoutNotContains(['application/vnd.plotly', '"data":', '"layout":']);
	});

	test('Python - Verify interactive HTML widget persists correctly after window reload', async function ({ python, app, openFile, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;

		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('interactive_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await inlineQuarto.expectOutputVisible();
		await inlineQuarto.expectWebviewOrHtmlVisible();

		// Verify no JSON blob before reload
		await inlineQuarto.expectStdoutNotContains(['application/vnd.plotly', '"data":']);

		// Skip reload in web mode (cache may not flush)
		if (app.web) {
			return;
		}

		// Reload window
		await hotKeys.reloadWindow(true);

		await editors.waitForActiveTab('interactive_plot.qmd', false);
		await inlineQuarto.expectKernelStatusVisible();

		// Verify output persisted
		await inlineQuarto.gotoLine(15);
		await inlineQuarto.expectOutputVisible({ timeout: 1000 });
		await inlineQuarto.expectWebviewOrHtmlVisible(1000);

		// Verify no JSON blob after reload
		await inlineQuarto.expectStdoutNotContains(['application/vnd.plotly', '"data":', '"layout":']);
	});
});
