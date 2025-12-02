/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Package Development', { tag: [tags.R_PKG_DEVELOPMENT, tags.ARK] }, () => {
	test.beforeAll(async function ({ app, r, settings }) {
		try {
			// don't use native file picker
			await settings.set({
				'files.simpleDialog.enable': true,
				'interpreters.startupBehavior': 'auto'
			});

			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
			await app.workbench.console.clearButton.click();
			await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		} catch (e) {
			await app.code.driver.takeScreenshot('rPackageSetup');
			throw e;
		}
	});

	test('R - Verify can open, test, check, install, and restart package', async function ({ app, openFolder, logger }) {
		test.slow();

		// Open an R package embedded in qa-example-content
		await openFolder(path.join('qa-example-content/workspaces/r_testing'));
		await app.workbench.console.waitForReadyAndStarted('>', 45000);

		await test.step('Test R Package', async () => {
			logger.log('Test R Package');
			await app.workbench.quickaccess.runCommand('r.packageTest');
			await expect(async () => {
				await app.workbench.terminal.waitForTerminalText('[ FAIL 1 | WARN 0 | SKIP 1 | PASS 16 ]', { timeout: 20000 });
				await app.workbench.terminal.waitForTerminalText('Terminal will be reused by tasks', { timeout: 20000 });
			}).toPass({ timeout: 70000 });
		});

		await test.step('Check R Package', async () => {
			logger.log('Check R Package');
			await app.workbench.quickaccess.runCommand('workbench.action.terminal.clear');
			await app.workbench.quickaccess.runCommand('r.packageCheck');
			await expect(async () => {
				await app.workbench.terminal.waitForTerminalText('Error: R CMD check found ERRORs', { timeout: 20000 });
				await app.workbench.terminal.waitForTerminalText('Terminal will be reused by tasks', { timeout: 20000 });
			}).toPass({ timeout: 70000 });
		});

		await test.step('Install R Package and Restart R', async () => {
			logger.log('Install R Package and Restart R');
			await app.workbench.quickaccess.runCommand('r.packageInstall');
			// Appears very briefly and test misses it:
			// await app.workbench.terminal.waitForTerminalText('✔ Installed testfun 0.0.0.9000');

			await app.workbench.console.waitForConsoleContents('restarted', { timeout: 30000 });
			await app.workbench.console.waitForConsoleContents('library(testfun)', { timeout: 30000 });

			await app.workbench.console.pasteCodeToConsole('(.packages())');
			await app.workbench.console.sendEnterKey();
			await app.workbench.console.waitForConsoleContents('"testfun"');
		});
	});
});
