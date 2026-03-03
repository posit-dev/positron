/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: R', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ r, settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('R - Verify inline output appears after running a code cell in Rmd file', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await editors.waitForActiveTab('simple_r.rmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_r.rmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 11, outputLine: 20 });
		await quartoInlineOutput.expectOutputVisible();
	});

	test('R - Verify multi-language document shows inline output for both languages', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput, console } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'multiple_languages.qmd'));
		await editors.waitForActiveTab('multiple_languages.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run R cell and verify output
		await editors.clickTab('multiple_languages.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });
		await quartoInlineOutput.expectOutputContainsText('Hello from R', { index: 0 });

		// Run Python cell and verify output
		await quartoInlineOutput.gotoLine(19);
		await quartoInlineOutput.runCurrentCell({ via: 'command' });
		await quartoInlineOutput.expectOutputContainsText(/\d+/, { index: 1 });

		// Also verify Python code sent to console
		await console.waitForConsoleContents('import os');
	});

	test('R - Verify error output appears exactly once, not duplicated', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'r_errors.qmd'));
		await editors.waitForActiveTab('r_errors.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('r_errors.qmd');
		await quartoInlineOutput.runCellAndWaitForOutput({ cellLine: 9, outputLine: 12 });
		await quartoInlineOutput.expectOutputVisible();
		await quartoInlineOutput.expectOutputItemCount(1);

		// Verify error message and count
		await quartoInlineOutput.expectErrorCount(1);
		await quartoInlineOutput.expectOutputContainsText('oh no');
	});

	test('R - Verify long text output is truncated with open in editor link', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'long_output.qmd'));
		await editors.waitForActiveTab('long_output.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run the cell and wait for output (longer timeout for R with 5000 numbers)
		await editors.clickTab('long_output.qmd');
		await quartoInlineOutput.gotoLine(7);
		await quartoInlineOutput.runCurrentCell({ via: 'command' });
		await quartoInlineOutput.expectOutputVisible();

		// Scroll to top to see truncation header
		await quartoInlineOutput.gotoLine(1);

		// Verify truncation header
		await expect(quartoInlineOutput.truncationHeader).toHaveCount(1, { timeout: 10000 });
		const headerText = await quartoInlineOutput.truncationHeader.textContent();
		expect(headerText).toMatch(/\.\.\.\d[\d,]* lines? omitted/);
		expect(headerText).toContain('(open in editor)');

		// Verify significant lines were omitted
		const omittedMatch = headerText?.match(/\.\.\.(\d[\d,]*) lines? omitted/);
		expect(omittedMatch).toBeTruthy();
		const omittedCount = parseInt(omittedMatch![1].replace(/,/g, ''), 10);
		expect(omittedCount).toBeGreaterThan(100);

		// Verify gradient line
		const gradientLine = quartoInlineOutput.inlineOutput.locator('.quarto-output-first-line-gradient');
		await expect(gradientLine).toHaveCount(1, { timeout: 5000 });

		// Click the open in editor link and verify new tab opens with full output
		await quartoInlineOutput.openInEditorLink.dispatchEvent('click');
		await editors.verifyTab('long_output.qmd', { isVisible: true, isSelected: false });
		await editors.verifyTab(/\[1\].*Output/, { isVisible: true, isSelected: true });
	});

	test('R - Verify execute code action steps through statements line by line with inline output', async function ({ app, openFile, page }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'multiple_statements.qmd'));
		await editors.waitForActiveTab('multiple_statements.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Helper to execute code at a line
		async function goToLineAndExecute(lineNumber: number) {
			await quartoInlineOutput.gotoLine(lineNumber);
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		}

		// Execute first line
		await editors.clickTab('multiple_statements.qmd');
		await goToLineAndExecute(11);
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputVisible();

		// Verify first statement output
		await quartoInlineOutput.expectOutputContainsText('first statement');
		await quartoInlineOutput.expectOutputNotContainsText('middle statement');
		await quartoInlineOutput.expectOutputNotContainsText('last');

		// Execute second line
		await goToLineAndExecute(12);
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputContainsText('middle statement');

		// Execute third line
		await goToLineAndExecute(13);
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputContainsText('is last');

		// Test selection execution
		await quartoInlineOutput.gotoLine(12);
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await quartoInlineOutput.gotoLine(15);
		await quartoInlineOutput.expectOutputContainsText('middle statement');

		// // Test multi-line statement - Quarto should execute the entire statement (lines 19-21)
		// await expect(async () => {
		// 	await quartoInlineOutput.gotoLine(19);
		// 	await page.waitForTimeout(500);
		// 	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		// 	await quartoInlineOutput.gotoLine(27);
		// 	await quartoInlineOutput.expectOutputsExist(2);
		// 	await quartoInlineOutput.expectOutputContainsText('6', { index: 1, timeout: 2000 });
		// }).toPass({ timeout: 15000 });
	});

	test('R - Verify execution options are respected when running all cells', async function ({ app, openFile, page }) {
		// Test currently skipped due to flaky behavior on Windows
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'execution_options.qmd'));
		await editors.waitForActiveTab('execution_options.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Run all cells
		await editors.clickTab('execution_options.qmd');
		await quartoInlineOutput.gotoLine(10);
		await quartoInlineOutput.runAllCells();

		// Verify outputs for each cell
		await quartoInlineOutput.expectOutputContainsText('This is the first cell.', { index: 0 });
		await quartoInlineOutput.expectOutputContainsText('Oh no', { index: 1 });
		await quartoInlineOutput.expectOutputContainsText('end of the world', { index: 2 });
		await quartoInlineOutput.expectOutputContainsText('awkward', { index: 3 });

		// Verify that the last cell did not execute due to error in previous cell
		await quartoInlineOutput.expectOutputNotContainsText('second cell');
		await quartoInlineOutput.expectOutputNotContainsText('How did we get here');
	});
});
