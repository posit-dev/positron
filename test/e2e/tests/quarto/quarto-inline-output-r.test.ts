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

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('R - Verify inline output appears after running a code cell in Rmd file', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto: inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await editors.waitForActiveTab('simple_r.rmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_r.rmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 20 });
		await inlineQuarto.expectOutputVisible();
	});

	test('R - Verify multi-language document shows inline output for both languages', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto, console } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'multiple_languages.qmd'));
		await editors.waitForActiveTab('multiple_languages.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run R cell and verify output
		await editors.clickTab('multiple_languages.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });
		await inlineQuarto.expectOutputContainsText('Hello from R', { index: 0 });

		// Run Python cell and verify session starts and output appears
		await inlineQuarto.gotoLine(19);
		await inlineQuarto.runCurrentCell();
		await inlineQuarto.expectOutputContainsText(/\d+/, { index: 1, timeout: 60000 }); // extra time so Python console session can start up

		// Also verify Python code sent to console
		await console.waitForConsoleContents('import os');
	});

	test('R - Verify error output appears exactly once, not duplicated', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'r_errors.qmd'));
		await editors.waitForActiveTab('r_errors.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('r_errors.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 9, outputLine: 12 });
		await inlineQuarto.expectOutputVisible();
		await inlineQuarto.expectOutputItemCount(1);

		// Verify error message and count
		await inlineQuarto.expectErrorCount(1);
		await inlineQuarto.expectOutputContainsText('oh no');
	});

	test('R - Verify long text output is truncated with open in editor link', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'long_output.qmd'));
		await editors.waitForActiveTab('long_output.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output (longer timeout for R with 5000 numbers)
		await editors.clickTab('long_output.qmd');
		await inlineQuarto.gotoLine(7);
		await inlineQuarto.runCurrentCell();
		await inlineQuarto.expectOutputVisible();

		// Scroll to top to see truncation header
		await inlineQuarto.gotoLine(1);

		// Verify truncation header
		await expect(inlineQuarto.truncationHeader).toHaveCount(1, { timeout: 10000 });
		const headerText = await inlineQuarto.truncationHeader.textContent();
		expect(headerText).toMatch(/\.\.\.\d[\d,]* lines? omitted/);
		expect(headerText).toContain('(open in editor)');

		// Verify significant lines were omitted
		const omittedMatch = headerText?.match(/\.\.\.(\d[\d,]*) lines? omitted/);
		expect(omittedMatch).toBeTruthy();
		const omittedCount = parseInt(omittedMatch![1].replace(/,/g, ''), 10);
		expect(omittedCount).toBeGreaterThan(100);

		// Verify gradient line
		const gradientLine = inlineQuarto.inlineOutput.locator('.quarto-output-first-line-gradient');
		await expect(gradientLine).toHaveCount(1, { timeout: 5000 });

		// Click the open in editor link and verify new tab opens with full output
		await inlineQuarto.openInEditorLink.dispatchEvent('click');
		await editors.verifyTab('long_output.qmd', { isVisible: true, isSelected: false });
		await editors.verifyTab(/\[1\].*Output/, { isVisible: true, isSelected: true });
	});

	test('R - Verify execute code action steps through statements line by line with inline output', async function ({ app, openFile, page, hotKeys, r }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'multiple_statements.qmd'));
		await editors.waitForActiveTab('multiple_statements.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Execute first line
		await editors.clickTab('multiple_statements.qmd');
		await inlineQuarto.runCodeAndWaitForOutput({ cellLine: 11, outputLine: 15 });

		// Verify first statement output
		await inlineQuarto.expectOutputContainsText('first statement');
		await inlineQuarto.expectOutputNotContainsText('middle statement');
		await inlineQuarto.expectOutputNotContainsText('last');

		// Execute second line
		await inlineQuarto.runCodeAndWaitForOutput({ cellLine: 12, outputLine: 15 });
		await inlineQuarto.expectOutputContainsText('middle statement');

		// Execute third line
		await inlineQuarto.runCodeAndWaitForOutput({ cellLine: 13, outputLine: 15 });
		await inlineQuarto.expectOutputContainsText('is last');

		// Test selection execution
		await inlineQuarto.gotoLine(12);
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await hotKeys.runCurrentQuartoCode();
		await inlineQuarto.gotoLine(15);
		await inlineQuarto.expectOutputContainsText('middle statement');

		// Test inline execution of a single line with multiple statements
		await inlineQuarto.gotoLine(19);
		await hotKeys.runCurrentQuartoCode();
		await inlineQuarto.expectOutputsExist(2);
		await inlineQuarto.expectOutputContainsText('6', { index: 1, timeout: 2000 });
	});

	// Test currently skipped due to flaky behavior on Windows
	test.skip('R - Verify execution options are respected when running all cells', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'execution_options.qmd'));
		await editors.waitForActiveTab('execution_options.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run all cells
		await editors.clickTab('execution_options.qmd');
		await inlineQuarto.gotoLine(10);
		await inlineQuarto.runAllCells();

		// Verify outputs for each cell
		await inlineQuarto.expectOutputContainsText('This is the first cell.', { index: 0 });
		await inlineQuarto.gotoLine(30);
		await inlineQuarto.expectOutputContainsText('Oh no', { index: 1 });
		await inlineQuarto.gotoLine(35);
		await inlineQuarto.expectOutputContainsText('end of the world', { index: 2 });
		await inlineQuarto.gotoLine(43);
		await inlineQuarto.expectOutputContainsText('awkward', { index: 3 });

		// Verify that the last cell did not execute due to error in previous cell
		await inlineQuarto.gotoLine(49);
		await inlineQuarto.expectOutputNotContainsText('second cell');
		await inlineQuarto.expectOutputNotContainsText('How did we get here');
	});
});
