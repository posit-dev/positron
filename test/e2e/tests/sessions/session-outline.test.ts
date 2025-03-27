/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Outline } from '../../pages/outline.js';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Session: Outline', {
	tag: [tags.WEB, tags.WIN, tags.SESSIONS, tags.OUTLINE]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Verify outline is based on editor and per session', async function ({ app, openFile, sessions }) {
		const { variables, outline, console, editor } = app.workbench;
		await variables.togglePane('hide');
		await outline.focus();

		await openFile('workspaces/outline/basic-outline-with-vars.py');
		await openFile('workspaces/outline/basic-outline-with-vars.r');

		// No active session - verify no outlines
		await editor.selectTab('basic-outline-with-vars.py');
		await outline.expectOutlineToBeEmpty();
		await editor.selectTab('basic-outline-with-vars.r');
		await outline.expectOutlineToBeEmpty();

		// Start sessions
		const [pySession1, pySession2, rSession1, rSession2] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

		// Select Python file
		await editor.selectTab('basic-outline-with-vars.py');
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
		await editor.selectTab('basic-outline-with-vars.r');
		await verifyROutline(outline);

		// Select R Session 1 - verify R outline
		await sessions.select(rSession1.id);
		await verifyROutline(outline);

		// Select R Session 2 - verify R outline
		await sessions.select(rSession2.id);
		await verifyROutline(outline);

		// Select Python file - verify Python outline
		await editor.selectTab('basic-outline-with-vars.py');
		await verifyPythonOutline(outline);

		// Python Session 2 - verify Python outline
		await sessions.select(pySession2.id);
		await console.typeToConsole('global_variable="goodbye2"', true);
		await verifyPythonOutline(outline);
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
