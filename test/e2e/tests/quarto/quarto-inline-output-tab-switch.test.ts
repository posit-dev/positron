/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Tab Switch Persistence', {
	tag: [tags.QUARTO, tags.DATA_EXPLORER]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('R - Inline data explorer survives tab switch to another file and back', async function ({ r, app, openFile }) {
		const { editors, inlineQuarto, inlineDataExplorer } = app.workbench;

		// Step 1: Open an R script file (non-Quarto)
		await openFile(join('workspaces', 'quarto_inline_output', 'multiline_statement.r'));
		await editors.waitForActiveTab('multiline_statement.r');

		// Step 2: Open a Quarto document with a data frame cell
		await openFile(join('workspaces', 'quarto_inline_output', 'r_data_frame.qmd'));
		await editors.waitForActiveTab('r_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Step 3: Run the cell and verify the inline data explorer appears
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 7, outputLine: 20 });
		await inlineQuarto.expectOutputVisible();
		await inlineDataExplorer.expectToBeVisible();
		await inlineDataExplorer.expectGridToBeReady();
		await inlineDataExplorer.expectShapeToContain(3, 2);

		// Step 4: Switch to the R script tab
		await editors.clickTab('multiline_statement.r');
		await editors.waitForActiveTab('multiline_statement.r');

		// Step 5: Switch back to the Quarto document
		await editors.clickTab('r_data_frame.qmd');
		await editors.waitForActiveTab('r_data_frame.qmd');

		// Step 6: Scroll to where the output should be and verify the data
		// explorer is still showing (not fallen back to text)
		await inlineQuarto.gotoLine(20);
		await inlineQuarto.expectOutputVisible();
		await inlineDataExplorer.expectToBeVisible();
		await inlineDataExplorer.expectGridToBeReady();
		await inlineDataExplorer.expectShapeToContain(3, 2);
		await inlineDataExplorer.expectColumnHeaderToBeVisible('Name');
		await inlineDataExplorer.expectCellValue('Name', 0, 'Alice');
	});
});
