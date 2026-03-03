/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Copy and Select', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify text can be selected via click and drag in inline output', async function ({ python, app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab('text_output.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('text_output.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectStdoutContains('Hello World');

		// Select text via drag and verify
		await quartoInlineOutput.selectStdoutTextViaDrag();
		await quartoInlineOutput.expectTextSelectedAndContains(['World', 'Hello', 'additional', 'text', 'Line']);
	});

	test('Python - Verify copy button appears in inline output and shows success feedback', async function ({ python, app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'copy_output_test.qmd'));
		await editors.waitForActiveTab('copy_output_test.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('copy_output_test.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 12, outputLine: 18 });

		// Copy and verify success feedback
		await quartoInlineOutput.copyOutput();

		// Wait for success state to revert
		await quartoInlineOutput.expectCopySuccessReverted();
	});

	test('Python - Verify copy output command copies text from cell output', async function ({ python, app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab('text_output.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('text_output.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });

		// Position cursor back in cell and use copy command
		await quartoInlineOutput.gotoLine(13);
		await quartoInlineOutput.runCopyCommand();

		// Verify success feedback
		await quartoInlineOutput.expectCopySuccess();
	});
});
