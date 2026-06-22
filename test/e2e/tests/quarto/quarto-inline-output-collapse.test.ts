/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from './_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Collapse', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify output can be collapsed and expanded by clicking the chevron', async function ({ python, app, openFile, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await inlineQuarto.expectOutputExpanded();

		await inlineQuarto.clickCollapseChevron();
		await inlineQuarto.expectOutputCollapsed();

		await inlineQuarto.clickCollapseChevron();
		await inlineQuarto.expectOutputExpanded();
	});

	test('Python - Verify output can be collapsed and expanded via toggle command', async function ({ python, app, openFile, runCommand, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		await editors.clickTab('simple_plot.qmd');
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await inlineQuarto.expectOutputExpanded();

		// Place the cursor inside the code cell so the toggle command finds it.
		await inlineQuarto.gotoLine(12);

		await runCommand('positronQuarto.toggleOutputCollapse');
		await inlineQuarto.expectOutputCollapsed();

		await runCommand('positronQuarto.toggleOutputCollapse');
		await inlineQuarto.expectOutputExpanded();
	});
});
