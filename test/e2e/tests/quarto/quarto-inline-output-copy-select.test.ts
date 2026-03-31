/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

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
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab('text_output.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('text_output.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });
		await inlineQuarto.expectStdoutContains('Hello World');

		// Select text via drag and verify
		await inlineQuarto.selectStdoutTextViaDrag();
		await inlineQuarto.expectTextSelectedAndContains(['World', 'Hello', 'additional', 'text', 'Line']);
	});

	test('Python - Verify copy button appears in inline output and shows success feedback', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'copy_output_test.qmd'));
		await editors.waitForActiveTab('copy_output_test.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('copy_output_test.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 18 });

		// Copy and verify success feedback
		await inlineQuarto.copyOutput();

		// Wait for success state to revert
		await inlineQuarto.expectCopySuccessReverted();
	});

	test('Python - Verify Ctrl+C copies editor text when inline output is enabled', async function ({ python, app, openFile, hotKeys }) {
		const { editors, inlineQuarto, clipboard } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab('text_output.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Go to line 2 (the title line: title: "Text Output Test")
		await inlineQuarto.gotoLine(2);

		// Select the line content using Home then Shift+End
		const page = app.code.driver.page;
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');

		// Copy with the standard copy shortcut (Ctrl+C / Cmd+C)
		await clipboard.copy();

		// Verify the clipboard contains the title line text
		await expect(async () => {
			const clipboardText = await clipboard.getClipboardText();
			expect(clipboardText).toContain('Text Output Test');
		}).toPass({ timeout: 5000 });
	});

	test('Python - Verify copy output command copies text from cell output', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab('text_output.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('text_output.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });

		// Position cursor back in cell and use copy command
		await inlineQuarto.gotoLine(13);
		await inlineQuarto.runCopyCommand();

		// Verify success feedback
		await inlineQuarto.expectCopySuccess();
	});
});
