/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables - Progress bar', { tag: [tags.WEB, tags.VARIABLES] }, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test('Run a long computation and see the progress bar appearing', async function ({ app, sessions }) {

		const session1 = await sessions.start('r');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		await app.workbench.console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
		await app.workbench.console.pasteCodeToConsole('Sys.sleep(20)', true);

		const variables = app.workbench.variables;

		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(false);
		}).toPass({ timeout: 2000 });

		// Now click delete all variables an expect the progress bar to appear
		await variables.clickDeleteAllVariables();
		await app.workbench.popups.confirmDeleteModalDialog();

		// Wait for the progress bar to appear
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(true);
		}).toPass({ timeout: 5000 });

		// Wait for the progress bar to disappear
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(false);
		}).toPass({ timeout: 30000 });

		// Next critical UI path is that we need to not show the progress bar when
		// user switches between sessions.

		// startup new session
		const session2 = await sessions.start('r', { reuse: false });

		await sessions.select(session2.id);
		await app.workbench.console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
		await app.workbench.console.pasteCodeToConsole('Sys.sleep(20)', true);

		// Now click delete all variables an expect the progress bar to appear
		await variables.clickDeleteAllVariables();
		await app.workbench.popups.confirmDeleteModalDialog();

		// Wait for the progress bar to appear
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(true);
		}).toPass({ timeout: 5000 });

		// Make sure the progress bar is not shown when switching sessions
		await sessions.select(session1.id);
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(false);
		}).toPass({ timeout: 20000 });

		// Go back to session2 and make sure the progress bar is shown
		await sessions.select(session2.id);
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(true);
		}).toPass({ timeout: 20000 });

		// Wait for the progress bar to disappear again
		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(false);
		}).toPass({ timeout: 30000 });

	});
});
