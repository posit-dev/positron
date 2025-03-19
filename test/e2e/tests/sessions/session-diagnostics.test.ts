/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra/index.js';
import { test, tags } from '../_test.setup.js';

const pythonSession1: SessionInfo = { ...pythonSession };
const pythonSession2: SessionInfo = { ...pythonSessionAlt };
const rSession1: SessionInfo = { ...rSession };
const rSession2: SessionInfo = { ...rSessionAlt };

test.use({
	suiteId: __filename
});

test.describe('Sessions: Diagnostics', {
	tag: [tags.SESSIONS, tags.PROBLEMS, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test.skip('Python - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand }) {
		const { sessions, problems, editor, console } = app.workbench;

		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		pythonSession2.id = await sessions.reuseIdleSessionIfExists(pythonSession2);

		// Open new Python file
		await runCommand('Python: New File');
		await editor.type('import requests\nrequests.get("https://example.com")\n');

		// Session 1 - before installing/importing package, the requests warning should be present
		await sessions.select(pythonSession1.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1 });
		await problems.expectWarningText('Import "requests" could not be resolved from source');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Session 1 - install/import 'requests' and verify no problems
		await console.executeCode('Python', 'pip install requests', { maximizeConsole: false });
		await console.executeCode('Python', 'import requests', { maximizeConsole: false });
		await problems.expectDiagnosticsToBe({ problemCount: 0, warningCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Session 2 - verify warning since requests was not installed in that session
		await sessions.select(pythonSession2.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1 });
		await problems.expectWarningText('Import "requests" could not be resolved from source');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Introduce a syntax error
		await editor.selectTabAndType('Untitled-1', 'x =');

		// Session 2 - verify 2 errors (import and syntax) are present
		await sessions.select(pythonSession2.id);
		await problems.expectDiagnosticsToBe({ problemCount: 3, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

		// Session 1 - verify 1 error (syntax) is present
		await sessions.select(pythonSession1.id);
		await problems.expectDiagnosticsToBe({ problemCount: 2, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

	});

	test('R - Verify diagnostics isolation between sessions in the editor and problems view', async function ({ app, runCommand }) {
		const { sessions, problems, editor, console } = app.workbench;

		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);
		rSession2.id = await sessions.reuseIdleSessionIfExists(rSession2);

		// Open new R file
		await runCommand('R: New File');
		await editor.type('circos.points()\n');

		// Session 1 - before installing/importing pkg the circos warning should be present
		await sessions.select(rSession1.id);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1 });
		await problems.expectWarningText('No symbol named \'circos.');
		await problems.expectSquigglyCountToBe('warning', 1);

		// Session 1 - install circlize and verify no problems
		await console.executeCode('R', "install.packages('circlize')", { maximizeConsole: false });
		await console.executeCode('R', 'library(circlize)', { maximizeConsole: false });
		await problems.expectDiagnosticsToBe({ problemCount: 0, warningCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);

		// Session 2 - verify warning since circlize is not installed
		await sessions.select(rSession2.id);
		await problems.expectSquigglyCountToBe('warning', 1);
		await problems.expectDiagnosticsToBe({ problemCount: 1, warningCount: 1 });
		await problems.expectWarningText('No symbol named \'circos.');

		// Introduce a syntax error
		await editor.selectTabAndType('Untitled-1', 'x <-');

		// Session 2 - verify 2 errors (circos and syntax) are present
		await sessions.select(rSession2.id);
		await problems.expectDiagnosticsToBe({ problemCount: 3, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);

		// Session 1 - verify 1 error (syntax) is present
		await sessions.select(rSession1.id);
		await problems.expectDiagnosticsToBe({ problemCount: 2, errorCount: 1 });
		await problems.expectSquigglyCountToBe('error', 1);
	});
});

