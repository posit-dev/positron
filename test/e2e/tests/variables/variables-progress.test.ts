/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { Console } from '../../pages/console.js';

test.use({
	suiteId: __filename
});

test.describe('Variables - Progress bar', { tag: [tags.WEB, tags.VARIABLES] }, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.stackedLayout();
	});

	test('Run a long computation and see the progress bar appearing', {
		tag: [tags.ARK]
	}, async function ({ app, sessions }) {

		const session1 = await sessions.start('r');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		const { variables, modals, console } = app.workbench;

		await console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
		await startLongComputation(console);

		await expect(async () => {
			expect(await variables.hasProgressBar()).toBe(false);
		}).toPass({ timeout: 2000 });

		// Now click delete all variables an expect the progress bar to appear
		await variables.clickDeleteAllVariables();
		await modals.expectToBeVisible('Delete All Variables');
		await modals.clickButton('Delete');

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
		await console.pasteCodeToConsole('hello <- 1; foo <- 2', true);
		await startLongComputation(console);

		// Now click delete all variables an expect the progress bar to appear
		await variables.clickDeleteAllVariables();
		await modals.expectToBeVisible('Delete All Variables');
		await modals.clickButton('Delete');

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

/**
 * Start a long computation and wait until the kernel has actually begun
 * running it. Pressing Enter returns before the execute request reaches the
 * kernel, and the console's Interrupt button shows as soon as the code is
 * submitted, so neither proves the kernel is busy. The clear request sent by
 * Delete All Variables must queue behind the sleep: against an idle kernel it
 * completes too fast for the progress bar to appear. The marker printed by
 * `cat` is emitted by the kernel itself, so once it is visible the sleep is
 * running. The marker is built from two strings so the echoed input line does
 * not also match it.
 */
async function startLongComputation(console: Console) {
	await console.pasteCodeToConsole('cat("started", "sleeping\\n"); Sys.sleep(20)', true);
	await console.waitForConsoleContents('started sleeping');
}
