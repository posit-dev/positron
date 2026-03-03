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

	test('Python - Verify DataFrame output shows HTML only, not duplicate text and HTML', async function ({ python, app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'py_data_frame.qmd'));
		await editors.waitForActiveTab('py_data_frame.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('py_data_frame.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await quartoInlineOutput.expectOutputVisible();

		// Verify exactly one output item (no duplicates)
		await quartoInlineOutput.expectOutputsExist(1);

		// Verify HTML output present
		await quartoInlineOutput.expectHtmlOutputVisible();

		// Verify no duplicate text output
		await quartoInlineOutput.expectStdoutNotContains(['col1', 'col2']);

		// Verify no data explorer metadata leaked
		await quartoInlineOutput.expectNoDataExplorerMetadata();
	});

	test('Python - Verify interactive HTML widget persists correctly after close and reopen', async function ({ python, app, openFile, hotKeys }) {
		const { editors, quartoInlineOutput } = app.workbench;

		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('interactive_plot.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await quartoInlineOutput.expectOutputVisible();

		// Verify webview/HTML output
		await quartoInlineOutput.expectWebviewOrHtmlVisible();

		// Close and reopen
		await hotKeys.closeAllEditors();
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');

		// Verify output persisted
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectWebviewOrHtmlVisible();

		// Verify no JSON blob
		await quartoInlineOutput.expectStdoutNotContains(['application/vnd.plotly', '"data":', '"layout":']);
	});

	test('Python - Verify interactive HTML widget persists correctly after window reload', async function ({ python, app, openFile }) {
		const { editors, quartoInlineOutput, quickaccess } = app.workbench;

		const filePath = join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd');

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(filePath);
		await editors.waitForActiveTab('interactive_plot.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('interactive_plot.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectWebviewOrHtmlVisible();

		// Verify no JSON blob before reload
		await quartoInlineOutput.expectStdoutNotContains(['application/vnd.plotly', '"data":']);

		// Skip reload in web mode (cache may not flush)
		if (app.web) {
			return;
		}

		// Reload window
		await quickaccess.runCommand('workbench.action.reloadWindow');

		await editors.waitForActiveTab('interactive_plot.qmd', false);
		await quartoInlineOutput.expectKernelStatusVisible();

		// Verify output persisted
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputVisible({ timeout: 1000 });
		await quartoInlineOutput.expectWebviewOrHtmlVisible(1000);

		// Verify no JSON blob after reload
		await quartoInlineOutput.expectStdoutNotContains(['application/vnd.plotly', '"data":', '"layout":']);
	});
});
