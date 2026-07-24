/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from './_test.setup';

test.use({
	suiteId: __filename
});

// The fixture's single code cell is taller than the editor viewport, so when
// the cursor sits at the top of the cell its inline output is rendered below
// the fold. This lets us verify that auto-scroll reveals output the user would
// otherwise not see (posit-dev/positron#14659) without navigating to the output
// ourselves (which would scroll on its own and mask the behavior).
const CELL_LINE = 15;

test.describe('Quarto - Inline Output: Auto Scroll', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - scrolls to reveal inline output produced below the viewport', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(join('workspaces', 'quarto_inline_output', 'autoscroll.qmd'));
		await editors.waitForActiveTab('autoscroll.qmd');
		await inlineQuarto.expectKernelStatusVisible();
		await editors.clickTab('autoscroll.qmd');

		// Auto-scroll is on by default: running the cell should bring its output
		// into view even though it starts below the fold.
		await inlineQuarto.runCellAndExpectOutputInViewport({ cellLine: CELL_LINE });
		await inlineQuarto.expectStdoutContains('AUTOSCROLL_MARKER');
	});

	test('Python - leaves the viewport alone when auto-scroll is disabled', async function ({ python, app, openFile, settings }) {
		const { editors, inlineQuarto } = app.workbench;

		await settings.set({ 'quarto.inlineOutput.autoScroll': false }, { reload: 'web' });

		await openFile(join('workspaces', 'quarto_inline_output', 'autoscroll.qmd'));
		await editors.waitForActiveTab('autoscroll.qmd');
		await inlineQuarto.expectKernelStatusVisible();
		await editors.clickTab('autoscroll.qmd');

		// With the setting off, the output is still produced but stays below the
		// fold -- the editor must not scroll on its own.
		await inlineQuarto.runCellAndExpectOutputNotInViewport({ cellLine: CELL_LINE });

		await settings.set({ 'quarto.inlineOutput.autoScroll': true }, { reload: 'web' });
	});
});
