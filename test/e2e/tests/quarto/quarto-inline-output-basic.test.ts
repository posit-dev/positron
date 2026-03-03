/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Basic', {
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

	test('Python - Verify inline output appears after running a code cell', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });

		// Verify output content
		await inlineQuarto.expectOutputVisible();
	});

	test('Python - Verify output is not duplicated after opening multiple qmd files', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open several qmd files to trigger multiple QuartoOutputContribution initializations
		await openFile(join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
		await editors.waitForActiveTab('quarto_basic.qmd');

		await openFile(join('workspaces', 'quarto_interactive', 'quarto_interactive.qmd'));
		await editors.waitForActiveTab('quarto_interactive.qmd');

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });

		// Verify there is exactly ONE output view zone, not duplicates
		await inlineQuarto.expectOutputsExist(1);

		// Verify the single output has exactly one output content area
		await inlineQuarto.expectOutputContentCount(1);
	});

	test('Python - Verify clicking X button clears inline output', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });

		// Scroll to make sure the output area is in view
		await inlineQuarto.gotoLine(20);
		await inlineQuarto.expectOutputVisible();

		// Close the output and verify it is cleared
		await inlineQuarto.closeOutput();
		await inlineQuarto.expectOutputsExist(0);
	});
});
