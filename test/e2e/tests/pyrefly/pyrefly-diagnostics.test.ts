/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Diagnostics', {
	tag: [tags.SESSIONS, tags.PROBLEMS, tags.WEB, tags.WIN, tags.SOFT_FAIL],
}, () => {

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
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Python Session 1 - restart session and verify no problems
		await sessions.restart(pySession.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Start Python Session 2 (same runtime) - verify no problems
		const pySession2 = await sessions.start('python', { reuse: false });
		await sessions.select(pySession2.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Python Alt Session - verify warning since pkg not installed
		await sessions.start('pythonAlt');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('Import "termcolor" could not be resolved');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Python Session 1 - restart session and verify no problems
		await sessions.select(pySession.id);
		await sessions.restart(pySession.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);
	});

});
