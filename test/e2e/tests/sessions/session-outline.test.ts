/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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

		// No Session - verify no outline elements
		await outline.expectOutlineToBeEmpty();

		// Start sessions
		const [pySession1, pySession2, rSession1, rSession2] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

		// Select Python file
		await editor.selectTab('basic-outline-with-vars.py');

		// Python Session 1 - verify only expected outline elements
		await sessions.select(pySession1.id);
		await console.typeToConsole('global_variable="goodbye"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');

		// Select R file
		await editor.selectTab('basic-outline-with-vars.r');

		// R Session 1 - verify only expected outline elements
		await sessions.select(rSession1.id);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// R Session 2 - verify only expected outline elements
		await sessions.select(rSession2.id);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// Select Python file
		await editor.selectTab('basic-outline-with-vars.py');

		// Python Session 2 - verify only expected outline elements
		await sessions.select(pySession2.id);
		await console.typeToConsole('global_variable="goodbye2"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');
	});
});
