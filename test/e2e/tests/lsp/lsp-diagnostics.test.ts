/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Diagnostics', {
	tag: [tags.PYREFLY, tags.WEB],
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'python.pyrefly.displayTypeErrors': 'force-on',
			'positron.notebook.enabled': true
		});
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('Python - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand, sessions }) {
		const { problems, editor, console } = app.workbench;

		// Start Python Session and install 'termcolor'
		const pySession = await sessions.start('python');
		await console.executeCode('Python', 'pip install termcolor', { maximizeConsole: false });

		// Open new Python file and use 'termcolor'
		await runCommand('Python: New File');
		await editor.type('import termcolor\n\ntermcolor.COLORS.copy()\n');

		// Python Session 1 - verify no problems
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0, timeout: 10000 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Python Session 1 - restart session and verify no problems
		await sessions.restart(pySession.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0, timeout: 10000 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Start Python Session 2 (same runtime) - verify no problems
		const pySession2 = await sessions.start('python', { reuse: false });
		await sessions.select(pySession2.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0, timeout: 10000 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Python Alt Session - verify warning since pkg not installed
		await sessions.start('pythonAlt');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1, timeout: 15000 });
		await problems.expectWarningText('Cannot find module `termcolor`');

	});

	test('Python - File shows diagnostic for non-existent module import', async function ({ app, runCommand, sessions, python }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('import bad_module\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 1, errorCount: 1 });
		await problems.expectWarningText('Cannot find module `bad_module`');
	});

	test('Python - Notebook shows diagnostic for undefined variable', async function ({ app, hotKeys }) {
		const { problems, notebooksPositron } = app.workbench;

		// create a new notebook
		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('Python');

		// add code with undefined variable and verify the diagnostic
		await notebooksPositron.addCodeToCell(0, 'x = 1\nprint(xx)');
		await notebooksPositron.expectCellContentAtIndexToBe(0, ['x = 1', 'print(xx)']);
		await problems.expectWarningText('Could not find name `xx`');

		await test.step('Fix the error', async () => {
			await notebooksPositron.selectCellAtIndex(0, { editMode: true });
			await hotKeys.selectAll();
			await app.code.driver.currentPage.keyboard.type('x = 1\nprint(x)');
			await notebooksPositron.expectCellContentAtIndexToBe(0, ['x = 1', 'print(x)']);
		});

		// verify the diagnostic is cleared
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
	});
});
