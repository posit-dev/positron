/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';
import { deletePositronHistoryFiles } from './helpers/deleteFiles.js';

test.use({
	suiteId: __filename
});

test.describe('Default Interpreters - R', {
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ userSettings }) {

		await userSettings.set([['files.simpleDialog.enable', 'true']]);

		await deletePositronHistoryFiles();

	});

	test('R - Add a default interpreter', async function ({ app, userSettings, runCommand }) {

		await app.workbench.console.waitForInterpretersToFinishLoading();

		// close qa-example-content
		await runCommand('workbench.action.closeFolder');

		await expect(async () => {
			await userSettings.set([['positron.r.interpreters.default', '"/home/runner/scratch/R-4.4.1/bin/R"']], false);
		}).toPass({ timeout: 45000 });

		await app.workbench.console.waitForReadyAndStarted('>', 30000);

		await app.workbench.console.barClearButton.click();

		await app.workbench.console.pasteCodeToConsole('cat(R.version.string, "\n")');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.waitForConsoleContents('4.4.1', { expectedCount: 1 });

		await app.workbench.console.pasteCodeToConsole('R.home()');
		await app.workbench.console.sendEnterKey();

		await app.workbench.console.waitForConsoleContents('/home/runner/scratch/R-4.4.1', { expectedCount: 1 });

		await app.workbench.settings.clearUserSettings();
	});
});
