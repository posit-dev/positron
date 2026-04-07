/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session Interpreter Sync Tests
 *
 * Verifies that the interpreter picker and console sessions stay in sync
 * when navigating between different file types (.R, .py, .ipynb).
 */

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Interpreter Sync', {
	tag: [tags.WIN, tags.WEB, tags.SESSIONS, tags.CONSOLE]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set(
			{
				'console.showNotebookConsoleActions': true,
				'positron.notebook.enabled': true
			},
			{ reload: 'web', waitMs: 1000 }
		);
	});

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Interpreter picker syncs when switching between notebook, .py and .R files', async function ({ app, sessions, openFile }) {
		const { editors, notebooksPositron } = app.workbench;

		const noInterpreter = 'Start Session';

		// Open a Python file - Python session should not start
		await openFile('/workspaces/generate-data-frames-py/simple-data-frames.py');
		await editors.verifyTab('simple-data-frames.py', { isVisible: true, isSelected: true });
		await sessions.expectSessionPickerToBe(noInterpreter);
		await sessions.expectSessionCountToBe(0); // session should not start until we run file

		// Open an R file - R session should not start
		await openFile('/workspaces/generate-data-frames-r/simple-data-frames.r');
		await editors.verifyTab('simple-data-frames.r', { isVisible: true, isSelected: true });
		await sessions.expectSessionPickerToBe(noInterpreter); // session should not start until we run file
		await sessions.expectSessionCountToBe(0);

		// Create a Python notebook - nb session should appear in session picker
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('Python'); // @dhruvisompura I have to select the kernel, is this expected?
		await notebooksPositron.kernel.expectKernelToBe({ kernelGroup: 'Python', status: 'idle' });
		await sessions.expectSessionPickerToBe(/Untitled-1\.ipynb/);
		await sessions.expectSessionCountToBe(0); // notebook session DOES exist, but not in console until we trigger it

		// Open notebook session in console
		await notebooksPositron.kernel.openNotebookConsole();
		await sessions.expectSessionCountToBe(1);

		// Run Python file - Python console session should be selected
		await editors.clickTab('simple-data-frames.py');
		await editors.runCurrentFile();
		await sessions.expectConsoleSessionToBeSelected(/^Python/);
		await sessions.expectSessionPickerToBe(/^Python/);

		// Run R file - R console session should be selected
		await editors.clickTab('simple-data-frames.r');
		await editors.runCurrentFile();
		await sessions.expectConsoleSessionToBeSelected(/^R/);
		await sessions.expectSessionPickerToBe(/^R/);

		// Select notebook - notebook session should be selected
		await editors.clickTab('Untitled-1');
		await sessions.expectConsoleSessionToBeSelected(/Untitled-1\.ipynb/);
		await sessions.expectSessionPickerToBe(/Untitled-1\.ipynb/);

		// Select Python file - last active console session (R) should be selected
		await editors.clickTab('simple-data-frames.py');
		await sessions.expectSessionPickerToBe(/^R/); // @dhruvisompura, is this right? Last active non-notebook session?
	});
});
