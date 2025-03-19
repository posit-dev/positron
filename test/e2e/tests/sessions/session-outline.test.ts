/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra/index.js';
import { test, tags } from '../_test.setup';

const pythonSession1a: SessionInfo = { ...pythonSession };
const pythonSession1b: SessionInfo = { ...pythonSession, name: `Python ${process.env.POSITRON_PY_VER_SEL} - 2`, };
const pythonSession2: SessionInfo = { ...pythonSessionAlt };
const rSession1a: SessionInfo = { ...rSession };
const rSession1b: SessionInfo = { ...rSession, name: `R ${process.env.POSITRON_R_VER_SEL} - 2`, };
const rSession2: SessionInfo = { ...rSessionAlt };

test.use({
	suiteId: __filename
});

test.describe('Session: Outline', {
	tag: [tags.WEB, tags.WIN, tags.SESSIONS, tags.OUTLINE]
}, () => {

	test.beforeAll(async function ({ userSettings }) {
		await userSettings.set([['console.multipleConsoleSessions', 'true']], true);
	});

	test('Python - Verify outline is per session', async function ({ app, openFile }) {
		const { sessions, variables, outline, console } = app.workbench;

		pythonSession1a.id = await sessions.launch(pythonSession1a);
		pythonSession1b.id = await sessions.launch(pythonSession1b);
		pythonSession2.id = await sessions.launch(pythonSession2);

		// Focus outline view and open Python file
		await variables.togglePane('hide');
		await outline.focus();
		await openFile('workspaces/outline/basic-outline-with-vars.py');

		// Session 1a - verify only expected outline elements
		await sessions.select(pythonSession1a.id);
		await console.typeToConsole('global_variable="goodbye"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');

		// Session 1b - verify only expected outline elements
		await sessions.select(pythonSession1b.id);
		await console.typeToConsole('global_variable="goodbye2"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');

		// Session 2 - verify only expected outline elements
		await sessions.select(pythonSession2.id);
		await console.typeToConsole('global_variable="goodbye3"', true);
		await outline.expectOutlineElementCountToBe(2);
		await outline.expectOutlineElementToBeVisible('global_variable = "hello"');
		await outline.expectOutlineElementToBeVisible('def demonstrate_scope');
	});

	test('R - Verify outline is per session', async function ({ app, openFile }) {
		const { sessions, variables, outline, console } = app.workbench;

		rSession1a.id = await sessions.launch(rSession1a);
		rSession1b.id = await sessions.launch(rSession1b);
		rSession2.id = await sessions.launch(rSession2);

		// Focus outline view and open Python file
		await variables.togglePane('hide');
		await outline.focus();
		await openFile('workspaces/outline/basic-outline-with-vars.r');

		// Session 1a - verify only expected outline elements
		await sessions.select(rSession1a.id);
		await console.typeToConsole('x<-"goodbye"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// Session 1b - verify only expected outline elements
		await sessions.select(rSession1b.id);
		await console.typeToConsole('x<-"goodbye2"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');

		// Session 2 - verify only expected outline elements
		await sessions.select(rSession2.id);
		await console.typeToConsole('x<-"goodbye3"', true);
		await outline.expectOutlineElementCountToBe(3);
		await outline.expectOutlineElementToBeVisible('demonstrate_scope');
		await outline.expectOutlineElementToBeVisible('global_variable');
		await outline.expectOutlineElementToBeVisible('local_variable');
	});
});
