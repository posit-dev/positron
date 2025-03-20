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
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/6872' }]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test.skip('Python - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand, sessions }) {
		const { problems, editor, console } = app.workbench;

		const [pySession, pyAltSession] = await sessions.start(['python', 'pythonAlt']);

		// Open new Python file
		await runCommand('Python: New File');
		await editor.type('import requests\nrequests.get("https://example.com")\n');

		// Session 1 - before installing/importing package, the requests warning should be present
		await sessions.select(pySession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('Import "requests" could not be resolved from source');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Session 1 - install & import 'requests' and verify no problems
		await console.executeCode('Python', 'pip install requests', { maximizeConsole: false });
		await console.executeCode('Python', 'import requests', { maximizeConsole: false });
		await problems.expectDiagnosticsToBe({ problemCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Session 2 - verify warning since requests was not installed in that session
		await sessions.select(pyAltSession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('Import "requests" could not be resolved from source');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Introduce a syntax error
		await editor.selectTabAndType('Untitled-1', 'x =');

		// Session 2 - verify both errors (import and syntax) are present
		await sessions.select(pyAltSession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 3, warningCount: 2, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

		// Session 1 - verify 1 error (syntax) is present
		await sessions.select(pySession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 2, warningCount: 1, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

	});

	test('R - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand, sessions }) {
		const { problems, editor, console } = app.workbench;

		const [rSession, rSessionAlt] = await sessions.start(['r', 'rAlt']);

		// Open new R file
		await runCommand('R: New File');
		await editor.type('circos.points()\n');

		// Session 1 - before installing/importing pkg the circos warning should be present
		await sessions.select(rSession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('No symbol named \'circos.');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Session 1 - install & import circlize and verify no problems
		await console.executeCode('R', "install.packages('circlize')", { maximizeConsole: false });
		await console.executeCode('R', 'library(circlize)', { maximizeConsole: false });
		await problems.expectDiagnosticsToBe({ problemCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Session 2 - verify warning since circlize is not installed
		await sessions.select(rSessionAlt.id);
		await problems.expectSquigglyCountToBe('warning', 1);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1, errorCount: 0 });
		await problems.expectWarningText('No symbol named \'circos.');

		// Introduce a syntax error
		await editor.selectTabAndType('Untitled-1', 'x <-');

		// Session 2 - verify both problems (circos and syntax) are present
		await sessions.select(rSessionAlt.id);
		await problems.expectDiagnosticsToBe({ problemCount: 3, warningCount: 2, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

		// Session 1 - verify only syntax error is present
		await sessions.select(rSession.id);
		await problems.expectDiagnosticsToBe({ problemCount: 2, warningCount: 1, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);
	});
});

