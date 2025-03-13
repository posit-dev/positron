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

test.describe('Default Interpreters - Python', {
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ userSettings }) {

		await userSettings.set([['files.simpleDialog.enable', 'true']]);

		await deletePositronHistoryFiles();

	});

	test('Python - Add a default interpreter (Conda)', async function ({ app, userSettings, runCommand }) {

		await app.workbench.console.waitForInterpretersToFinishLoading();

		// close qa-example-content
		await runCommand('workbench.action.closeFolder');

		await expect(async () => {
			// local debugging sample:
			// const homeDir = process.env.HOME || '';
			// await userSettings.set([['python.defaultInterpreterPath', `"${path.join(homeDir, '.pyenv/versions/3.13.0/bin/python')}"`]], false);

			// hidden interpreter (Conda)
			await userSettings.set([['python.defaultInterpreterPath', '"/home/runner/scratch/python-env/bin/python"']], false);
		}).toPass({ timeout: 45000 });

		await app.workbench.console.waitForReadyAndStarted('>>>', 30000);

		await app.workbench.console.barClearButton.click();

		await app.workbench.console.pasteCodeToConsole('import sys; print(sys.version)');
		await app.workbench.console.sendEnterKey();

		// local debugging sample:
		// await app.workbench.console.waitForConsoleContents('3.13.0', { expectedCount: 1 });

		// hidden interpreter (Conda)
		await app.workbench.console.waitForConsoleContents('3.12.9', { expectedCount: 1 });

		await app.workbench.settings.clearUserSettings();
	});
});
