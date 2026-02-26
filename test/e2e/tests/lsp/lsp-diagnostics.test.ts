/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Diagnostics', {
	tag: [tags.PYREFLY, tags.WEB],
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'python.pyrefly.displayTypeErrors': 'force-on' });
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
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('Cannot find module `termcolor`');

		// does pyrefly use squiggly correctly?
		// await problems.expectSquigglyCountToBe('warning', 1);

		// Python Session 1 - restart session and verify no problems
		/* skipping for now until this is fixed with pyrefly
		await sessions.select(pySession.id);
		await sessions.restart(pySession.id);
		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		await problems.expectSquigglyCountToBe('warning', 0);
		*/
	});

	// Adding these additional tests to ensure a more robust coverage
	// The idea is to use different scenarios as a proxy for potential pyrefly issues/delays/halts
	// Some tests may appear redundant, but they are designed to catch potential breakages in pyrefly functionality

	test('Python - File shows diagnostic for non-existent module import', async function ({ app, runCommand, sessions, python }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('import bad_module\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 2, warningCount: 1, errorCount: 1 });
		await problems.expectWarningText('Cannot find module `bad_module`');
	});

	test('Python - File shows diagnostic for missing attribute on module', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('import math\nmath.not_a_real_attr\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('No attribute');
	});

	test('Python - File shows diagnostic for calling non-callable', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('x = 1\nx()\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('Expected a callable');
	});

	test('Python - File shows diagnostic for incompatible assignment (annotated int)', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('x: int = "hello"\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('not assignable');
	});

	test('Python - File shows diagnostic for wrong return type', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('def f() -> int:\n\treturn "nope"\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('Return type');
	});

	test('Python - File shows diagnostic for list element type mismatch', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('xs: list[int] = [1, "a"]\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('not assignable');
	});

	test('Python - File shows diagnostic for dict value type mismatch', async function ({ app, runCommand }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('m: dict[str, int] = {"a": 1, "b": "x"}\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		await problems.expectWarningText('not assignable');
	});

	test('Python - File shows type errors when indentation error is present', async function ({ app, runCommand, sessions, python }) {
		const { problems, editor } = app.workbench;
		await runCommand('Python: New File');
		await editor.type('def greet(name: str) -> str:\n\treturn f"Hello, {name}"\n\n# Type error: passing int instead of str\nresult = greet(123)\n');
		await problems.expectDiagnosticsToBe({ badgeCount: 6, warningCount: 0, errorCount: 6 });
	});

	// NOTE[RSF]: Unskip/fix tests for QMD and Notebook files
	// Currently skipping due to pyrefly not working with .qmd and .ipynb

	test.skip('Python - QMD file shows diagnostic for undefined variable', async function ({ app, runCommand }) {
		const { problems, editor, quickInput, hotKeys } = app.workbench;
		await runCommand('workbench.action.files.newUntitledFile');
		await editor.type('---\ntitle: "Test"\n---\n\n```{python}\nprint(does_not_exist)\n```\n');

		await runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(path.join(app.workspacePathOrFolder, 'smoke.qmd'));
		await app.code.driver.page.keyboard.press('Enter');
		await quickInput.waitForQuickInputClosed();
		await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });

		await hotKeys.selectAll();
		await editor.type('---\ntitle: "Test"\n---\n\n```{python}\nx = 1\nprint(x)\n```\n');

		await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
	});

	test.skip('Python - Notebook shows diagnostic for undefined variable', async function ({ app, runCommand, hotKeys }) {
		const { problems, notebooks } = app.workbench;

		await test.step('Create notebook', async () => {
			await runCommand('Python: Create New Notebook');
			await notebooks.selectCellAtIndex(0);
		});

		await test.step('Add code with undefined variable', async () => {
			await notebooks.typeInEditor('x = 1\nprint(xx)');
			await notebooks.waitForActiveCellEditorContents('x = 1 print(xx)');
		});

		await test.step('Verify diagnostic appears', async () => {
			await problems.expectDiagnosticsToBe({ badgeCount: 1, warningCount: 0, errorCount: 1 });
		});

		await test.step('Fix the error', async () => {
			await hotKeys.selectAll();
			await notebooks.typeInEditor('x = 1\nprint(x)');
			await notebooks.waitForActiveCellEditorContents('x = 1 print(x)');
		});

		await test.step('Verify diagnostic is cleared', async () => {
			await problems.expectDiagnosticsToBe({ badgeCount: 0, warningCount: 0, errorCount: 0 });
		});
	});

});
