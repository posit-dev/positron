/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { pythonSession, pythonSessionAlt, rSession, rSessionAlt, SessionInfo } from '../../infra/index.js';
import { test, tags } from '../_test.setup.js';
import { join } from 'path';

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

	test.beforeEach(async function ({ app }) {
		// hide variables pane to avoid line wrapping
		await app.workbench.variables.togglePane('hide');
	});

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('Python - Verify problems are highlighted in editor and count is accurate in Problems pane', async function ({ app, openFile, keyboard }) {
		const { problems, editor, sessions } = app.workbench;

		pythonSession1.id = await sessions.reuseIdleSessionIfExists(pythonSession1);
		pythonSession2.id = await sessions.reuseIdleSessionIfExists(pythonSession2);

		// Open a Python file and introduce an error
		await openFile(join('workspaces/graphviz/pydotSample.py'));
		await editor.replaceTerm('pydotSample.py', 'graph', 13, '!');

		// Verify the error is present in Editor and Problems pane
		await sessions.select(pythonSession1.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(4);

		// Switch to another session and verify the error is present
		await sessions.select(pythonSession2.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(4);

		// Switch back to the first session and verify the error is still present
		await sessions.select(pythonSession1.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(4);

		// Undo the changes
		await keyboard.hotKeys.undo();

		// Verify the error is no longer present in Editor and Problems view
		await sessions.select(pythonSession1.id);
		await problems.expectSquigglyNotToBeVisible('error');
		await problems.expectProblemsCountToBe(0);

		// Switch to other session and verify the error is no longer present
		await sessions.select(pythonSession2.id);
		await problems.expectSquigglyNotToBeVisible('error');
		await problems.expectProblemsCountToBe(0);
	});

	test('R - Verify problems are highlighted in editor and count is accurate in Problems pane', async function ({ app, keyboard, openFile }) {
		const { sessions, problems, editor } = app.workbench;

		rSession1.id = await sessions.reuseIdleSessionIfExists(rSession1);
		rSession2.id = await sessions.reuseIdleSessionIfExists(rSession2);

		// Open an R file and introduce an error
		await openFile('workspaces/r-plots/plotly-example.r');
		await editor.replaceTerm('plotly-example.r', 'midwest', 2, '!');

		// Verify the error is present in Editor and Problems pane
		await sessions.select(rSession1.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(1);

		// Switch to another session and verify the error is present
		await sessions.select(rSession2.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(1);

		// Switch back to the first session and verify the error is still present
		await sessions.select(rSession1.id);
		await problems.expectSquigglyToBeVisible('error');
		await problems.showProblemsView();
		await problems.expectProblemsCountToBe(1);

		// Undo the changes
		await keyboard.hotKeys.undo();

		// Verify the error is no longer present in Editor and Problems view
		await sessions.select(rSession1.id);
		await problems.expectSquigglyNotToBeVisible('error');
		await problems.expectProblemsCountToBe(0);

		// Switch to other session and verify the error is no longer present
		await sessions.select(rSession2.id);
		await problems.expectSquigglyNotToBeVisible('error');
		await problems.expectProblemsCountToBe(0);
	});
});

