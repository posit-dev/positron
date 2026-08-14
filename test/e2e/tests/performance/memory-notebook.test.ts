/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

/**
 * 30 cells: 19 code, 11 markdown, and 19 of them carrying stored outputs (19
 * stream, 8 execute_result, 1 display_data).
 *
 * Chosen over building cells up through the POM, and over an empty notebook: a
 * one-cell notebook measured only +31 MB over session-python, which says almost
 * nothing about the renderer and webview path this scenario exists to watch.
 */
const NOTEBOOK = 'workspaces/pokemon/ds-workflow2.ipynb';
const CELL_COUNT = 30;

// Runs against a Python session, so the interesting figure is this scenario minus
// session-python, not minus idle: what the notebook editor, its cell editors, and
// its rendered outputs cost on top of a session that already exists. The
// cross-scenario summary deltas everything against idle today, so that subtraction
// is by eye until #15495.
defineMemoryScenario({
	scenario: 'notebook',
	prepare: async ({ app }) => {
		const { notebooksPositron } = app.workbench;

		// openNotebook, not the openFile fixture: openFile ends in
		// editors.selectTab -> waitForEditorFocus, which waits for a focused
		// `.monaco-editor[data-uri$=...] .native-edit-context`. A notebook editor has
		// no such text-editor context, so openFile times out on an .ipynb.
		await notebooksPositron.openNotebook(NOTEBOOK);

		// Fails loudly if that default ever flips. This scenario exists to measure the
		// Positron notebook editor, and the legacy one would publish a different app
		// state under the same series name. Asserted rather than pinned in
		// settingsMemory.json, which is shared with idle and would move idle's baseline.
		await notebooksPositron.expectToBeVisible();

		// Proves the whole notebook parsed and rendered, not just that an editor
		// opened. Without it a partial render would publish as a cheap notebook.
		await notebooksPositron.expectCellCountToBe(CELL_COUNT);

		// Selected explicitly because settingsMemory.json pins startup behavior to
		// manual for every memory scenario, so nothing auto-starts. waitForReady
		// defaults on, which is the settle point before the collector takes over.
		await notebooksPositron.kernel.select('Python');

		// One trivial cell appended and run, rather than running the notebook's own
		// 30: those execute real analysis code with third-party imports, so a missing
		// dependency in the container would turn a memory job into a red herring and
		// the runtime would be unbounded. The stored outputs above already give the
		// render cost; this only has to prove the kernel really executes.
		await notebooksPositron.addCodeToCell(CELL_COUNT, 'print("hello")', { run: true });
		await notebooksPositron.expectOutputAtIndex(CELL_COUNT, ['hello']);
	},
	// Same gate as session-python: kernel only exists once a session really started,
	// so it is what stops a failed run from publishing an idle-shaped number.
	expectRoles: ['kernel', 'kernel_supervisor']
});
