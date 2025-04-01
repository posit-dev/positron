/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Outline } from '../../pages/outline.js';
import { test, tags } from '../_test.setup';

const R_FILE = 'basic-outline-with-vars.r';
const PY_FILE = 'basic-outline-with-vars.py';

test.use({
	suiteId: __filename
});

test.describe('Session: Outline', {
	tag: [tags.WEB, tags.WIN, tags.SESSIONS, tags.OUTLINE]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test.beforeAll(async function ({ app, openFile }) {
		const { variables, outline } = app.workbench;

		await openFile(`workspaces/outline/${PY_FILE}`);
		await openFile(`workspaces/outline/${R_FILE}`);

		await variables.togglePane('hide');
		await outline.focus();
	});

	test('Verify outline is based on editor and per session', async function ({ app, openFile, sessions }) {
		const { outline, console, editor } = app.workbench;

		// No active session - verify no outlines
		await editor.selectTab(PY_FILE);
		await outline.expectOutlineToBeEmpty();
		await editor.selectTab(R_FILE);
		await outline.expectOutlineToBeEmpty();

		// Start sessions
		const [pySession1, pySession2, rSession1, rSession2] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

		// Select Python file
		await editor.selectTab(PY_FILE);
		await verifyPythonOutline(outline);

		// Select R Session 1 - verify Python outline
		// Use last-active Python session's LSP for Python files, even if foreground session is R.
		await sessions.select(rSession1.id);
		await verifyPythonOutline(outline);

		// Select Python Session 1 - verify Python outline
		await sessions.select(pySession1.id);
		await console.typeToConsole('global_variable="goodbye"', true);
		await verifyPythonOutline(outline);

		// Select R file
		await editor.selectTab(R_FILE);
		await verifyROutline(outline);

		// Select R Session 1 - verify R outline
		await sessions.select(rSession1.id);
		await verifyROutline(outline);

		// Select R Session 2 - verify R outline
		await sessions.select(rSession2.id);
		await verifyROutline(outline);

		// Select Python file - verify Python outline
		await editor.selectTab(PY_FILE);
		await verifyPythonOutline(outline);

		// Python Session 2 - verify Python outline
		await sessions.select(pySession2.id);
		await console.typeToConsole('global_variable="goodbye2"', true);
		await verifyPythonOutline(outline);
	});

	test('Verify outline after reload with R in foreground and Python in background', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7052' }],
	}, async function ({ app, runCommand, sessions }) {
		const { outline, editor } = app.workbench;

		// Start sessions
		const [, rSession] = await sessions.start(['python', 'r']);

		// Verify outlines for both file types
		await editor.selectTab(PY_FILE);
		await verifyPythonOutline(outline);

		await editor.selectTab(R_FILE);
		await verifyROutline(outline);

		// Reload window
		await runCommand('workbench.action.reloadWindow');

		// Verify outlines for both file types
		await editor.selectTab(PY_FILE);
		await verifyPythonOutline(outline);

		await editor.selectTab(R_FILE);
		await sessions.select(rSession.id); // Issue 7052 - we shouldn't have to click the tab
		await verifyROutline(outline);
	});
});

async function verifyPythonOutline(outline: Outline) {
	await outline.expectOutlineElementCountToBe(2); // ensure no dupes from multisessions
	await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
	await outline.expectOutlineElementToBeVisible('def demonstrate_scope');
}

async function verifyROutline(outline: Outline) {
	await outline.expectOutlineElementCountToBe(3); // ensure no dupes from multisessions
	await outline.expectOutlineElementToBeVisible('demonstrate_scope');
	await outline.expectOutlineElementToBeVisible('global_variable');
	await outline.expectOutlineElementToBeVisible('local_variable');
}
