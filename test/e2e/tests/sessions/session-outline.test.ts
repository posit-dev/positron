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

	test('Python - Verify outline is per session', async function ({ app, openFile, sessions }) {
		const { variables, outline, console } = app.workbench;

		const [pySession1, pySession2, pyAltSession] = await sessions.start(['python', 'python', 'pythonAlt']);

		// Focus outline view and open Python file
		await variables.togglePane('hide');
		await outline.focus();
		await openFile('workspaces/outline/basic-outline-with-vars.py');

		// Session 1a - verify only expected outline elements
		await sessions.select(pySession1.id);
		await console.typeToConsole('global_variable="goodbye"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');

		// Session 1b - verify only expected outline elements
		await sessions.select(pySession2.id);
		await console.typeToConsole('global_variable="goodbye2"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');

		// Session 2 - verify only expected outline elements
		await sessions.select(pyAltSession.id);
		await console.typeToConsole('global_variable="goodbye3"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');
	});

	test('R - Verify outline is per session', async function ({ app, openFile, sessions }) {
		const { variables, outline, console } = app.workbench;

		const [rSession1, rSession2, rSessionAlt] = await sessions.start(['r', 'r', 'rAlt']);

		// Focus outline view and open Python file
		await variables.togglePane('hide');
		await outline.focus();
		await openFile('workspaces/outline/basic-outline-with-vars.r');

		// Session 1a - verify only expected outline elements
		await sessions.select(rSession1.id);
		await console.typeToConsole('x<-"goodbye"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// Session 1b - verify only expected outline elements
		await sessions.select(rSession2.id);
		await console.typeToConsole('x<-"goodbye2"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// Session 2 - verify only expected outline elements
		await sessions.select(rSessionAlt.id);
		await console.typeToConsole('x<-"goodbye3"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');
	});
});
