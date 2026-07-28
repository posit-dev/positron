/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
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

	test('Python - running a cell in one split pane does not scroll the other pane', async function ({ python, app, openFile, runCommand }) {
		const { editors, inlineQuarto } = app.workbench;

		await openFile(join('workspaces', 'quarto_inline_output', 'autoscroll.qmd'));
		await editors.waitForActiveTab('autoscroll.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Open the same document in a second, side-by-side editor. The split
		// leaves the new (right) group active and both panes scrolled to the top,
		// so the cell's output starts below the fold in each.
		await runCommand('workbench.action.splitEditorRight');
		await editors.expectEditorGroupCount(2);
		await editors.expectEditorGroupActive(1);

		const leftOutput = inlineQuarto.getOutputContentInGroup(editors.editorGroup(0));
		const rightOutput = inlineQuarto.getOutputContentInGroup(editors.editorGroup(1));

		// Run the cell in the active (right) pane. Auto-scroll should reveal its
		// output there. (Re-fire the run until the output scrolls into view, as
		// the single-pane test does, to survive a swallowed run hotkey.)
		await expect(async () => {
			await inlineQuarto.gotoLine(CELL_LINE);
			await inlineQuarto.runCurrentCell();
			await expect(rightOutput.first()).toBeInViewport({ timeout: 20000 });
		}).toPass({ timeout: 120000, intervals: [2000] });

		// The run must not hijack the left pane: it never armed auto-scroll, so
		// its viewport stays put and the same output remains below the fold.
		// (Before the fix both panes armed off the URI-keyed execution event and
		// the left pane scrolled in lockstep with the right.)
		await expect(leftOutput.first()).not.toBeInViewport();
	});
});
