/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Sessions: Diagnostics', {
	tag: [tags.SESSIONS, tags.PROBLEMS, tags.WEB, tags.WIN],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6970' }]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('Python - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand, sessions }) {
		const { problems, editor, console } = app.workbench;

		// Start Python Session and open new Python file
		const pySession = await sessions.start('python');
		await runCommand('Python: New File');
		await editor.type('import termcolor\ntermcolor.COLORS.copy()\nprint(x)\n');

		// Python Session 1 - install & import 'termcolor', assign variable x - verify no problems
		await console.executeCode('Python', 'x=123', { maximizeConsole: false });
		await console.executeCode('Python', 'pip install termcolor', { maximizeConsole: false });
		await console.executeCode('Python', 'import termcolor', { maximizeConsole: false });
		// bug 6970: this should be 0, x has been defined
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 1);

		// Python Session 1 - restart session and verify no problems
		await sessions.restart(pySession.id);
		// bug 6970: this should be 0, x has been defined
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 1);

		// Start Python Session 2 (same runtime) - verify only syntax error for variable x
		const pySession2 = await sessions.start('python', { reuse: false });
		await sessions.select(pySession2.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('"x" is not defined');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Python Session 1 - restart session and verify no problems
		await sessions.select(pySession.id);
		await sessions.restart(pySession.id);
		// bug 6970: this should be 0, x has been defined
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 1);

		// Python Alt Session - verify warning since pkg was not installed in that runtime
		await sessions.start('pythonAlt');
		await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 2, errorCount: 0 });
		await problems.expectWarningText('"x" is not defined');
		await problems.expectWarningText('Import "termcolor" could not be resolved');
		await problems.expectSquigglyCountToBe('warning', 2);

		// Python Session 1 - restart session and verify no problems
		await sessions.select(pySession.id);
		await sessions.restart(pySession.id);
		// bug 6970: this should be 0, x has been defined
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 1);
	});

	test('R - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand, sessions }) {
		const { problems, editor, console } = app.workbench;

		const [rSession, rSessionAlt] = await sessions.start(['r', 'rAlt']);

		// Open new R file
		await runCommand('R: New File');
		await editor.type('circos.points()\n');

		// Session 1 - install & import circlize and verify no problems
		await sessions.select(rSession.id);
		await console.executeCode('R', "install.packages('circlize')", { maximizeConsole: false });
		await console.executeCode('R', 'library(circlize)', { maximizeConsole: false });
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Session 2 - verify warning since circlize is not installed
		await sessions.select(rSessionAlt.id);
		await problems.expectSquigglyCountToBe('warning', 1);
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('No symbol named \'circos.');

		// Introduce a syntax error
		await editor.selectTabAndType('Untitled-1', 'x <-');

		// Session 2 - verify both problems (circos and syntax) are present
		await sessions.select(rSessionAlt.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 3, warningCount: 2, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

		// Session 1 - verify only syntax error is present
		await sessions.select(rSession.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 1, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);
	});
});

