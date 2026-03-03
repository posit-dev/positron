/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Persistence', {
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

	test('Python - Verify inline output persists after closing and reopening file', async function ({ app, python, openFile, hotKeys }) {
		const { editors, quartoInlineOutput } = app.workbench;
		const filePath = join('workspaces', 'quarto_inline_output', 'simple_plot.qmd');

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(filePath);
		await editors.waitForActiveTab('simple_plot.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await quartoInlineOutput.expectOutputVisible();

		// Close and reopen the file
		await hotKeys.closeAllEditors();
		await openFile(filePath);
		await editors.waitForActiveTab('simple_plot.qmd');

		// Verify output persisted
		await quartoInlineOutput.gotoLine(25);
		await quartoInlineOutput.expectOutputVisible();
	});

	test('Python - Verify kernel status persists after window reload', async function ({ app, python, openFile, hotKeys }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });

		// Get initial kernel text
		const initialKernelText = await quartoInlineOutput.getKernelText();

		// Reload window and wait for kernel status to be visible again
		await hotKeys.reloadWindow(true);
		await quartoInlineOutput.expectKernelStatusVisible();
		await quartoInlineOutput.expectKernelToHaveText(initialKernelText);
	});

	test('Python - Verify inline output works in untitled Quarto document and persists through save', async function ({ app, python, page, runCommand, hotKeys, saveFileAs }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Set up a unique filename for the untitled document
		const savedFileName = `untitled-test-${Math.random().toString(36).substring(7)}.qmd`;

		// Open a new untitled Quarto document
		await runCommand('quarto.newDocument');
		await editors.waitForActiveTab('Untitled-1');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Add a Python code cell
		await editors.clickTab('Untitled-1');
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(`
\`\`\`{python}
print("Hello from untitled!")
\`\`\``);

		// Run using toolbar and verify output
		await quartoInlineOutput.clickToolbarRunButton(0);
		await quartoInlineOutput.gotoLine(10);
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectStdoutContains('Hello from untitled!');

		// Save the file as a new Quarto document
		await saveFileAs(join(app.workspacePathOrFolder, savedFileName));

		// Wait for tab to update and kernel status to be visible again
		await editors.waitForActiveTab(savedFileName, false);
		await quartoInlineOutput.expectKernelStatusVisible();

		// Verify output still visible after save
		await quartoInlineOutput.gotoLine(10);
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectStdoutContains('Hello from untitled!');

		// Reload and wait for kernel status to be visible again
		await hotKeys.reloadWindow(true);
		await quartoInlineOutput.expectKernelStatusVisible();

		// Verify output still visible after reload
		await quartoInlineOutput.gotoLine(10);
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectStdoutContains('Hello from untitled!');
	});
});
