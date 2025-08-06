/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console: Add +', {
	tag: [tags.SESSIONS, tags.CONSOLE, tags.WEB, tags.WIN]
}, () => {

	test('Validate can duplicate runtime via Console + button', {
		tag: [tags.ARK]
	}, async function ({ app, page }) {
		const { sessions, console } = app.workbench;
		await sessions.start(['r']);

		// Click the `+` button in the console to add a new session of the same type
		await console.clickDuplicateSessionButton();
		await expect(page.getByTestId(/console-tab-r-*/)).toHaveCount(2);
		await sessions.expectAllSessionsToBeReady();
	});

	test('Validate can start a different runtime via Console + button', {
		tag: [tags.ARK]
	}, async function ({ app, page }) {
		const { sessions, console } = app.workbench;
		await sessions.start(['r', 'r']);

		// Click the `+ v` button in the console to Start Another session
		await console.clickStartAnotherSessionButton('python');
		await expect(page.getByTestId(/console-tab-r-*/)).toHaveCount(2);
		await expect(page.getByTestId(/console-tab-python-*/)).toHaveCount(1);
		await sessions.expectAllSessionsToBeReady();
	});

	test('Validate Console + button menu shows both active and disconnected sessions', {
		tag: [tags.ARK]
	}, async function ({ app }) {
		const { sessions, console } = app.workbench;
		const [pythonSession, rSession] = await sessions.start(['python', 'r', 'r', 'r', 'r', 'r', 'r',]);

		// Verify the Python and R sessions are listed in the console `+` menu
		await console.expectSessionContextMenuToContain([rSession.name, pythonSession.name]);

		// Disconnect the R session
		await sessions.select(rSession.id);
		await console.pasteCodeToConsole('q()', true);
		await sessions.expectStatusToBe(rSession.id, 'disconnected');

		// Disconnect the Python session
		await sessions.select(pythonSession.id);
		await console.pasteCodeToConsole('exit()', true);
		await sessions.expectStatusToBe(pythonSession.id, 'disconnected');

		// Verify the disconnected sessions are still in the console `+` menu
		await console.expectSessionContextMenuToContain([rSession.name, pythonSession.name]);
	});
});
