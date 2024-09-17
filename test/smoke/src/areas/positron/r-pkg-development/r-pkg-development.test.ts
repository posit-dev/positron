/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import { Application, Logger, PositronRFixtures, PositronUserSettingsFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('R Package Development', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;
		let userSettings: PositronUserSettingsFixtures;

		describe('R Package Development - R', () => {
			before(async function () {
				app = this.app as Application;
				try {
					await PositronRFixtures.SetupFixtures(this.app as Application);
					userSettings = new PositronUserSettingsFixtures(app);

					// don't use native file picker
					await userSettings.setUserSetting(['files.simpleDialog.enable', 'true']);
					await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
					await app.workbench.positronConsole.barClearButton.click();
					await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
				} catch (e) {
					this.app.code.driver.takeScreenshot('rPackageSetup');
					throw e;
				}
			});

			after(async function () {
				// unset the use of the VSCode file picker
				await userSettings.unsetUserSettings();
			});

			it('R Package Development Tasks [C809821]', async function () {
				await expect(async () => {
					// Navigate to https://github.com/posit-dev/qa-example-content/tree/main/workspaces/r_testing
					// This is an R package embedded in qa-example-content
					await app.workbench.quickaccess.runCommand('workbench.action.files.openFolder', { keepOpen: true });
					await app.workbench.quickinput.waitForQuickInputOpened();
					await app.workbench.quickinput.type(path.join(app.workspacePathOrFolder, 'workspaces', 'r_testing'));
					// Had to add a positron class, because Microsoft did not have this:
					await app.workbench.quickinput.clickOkOnQuickInput();

					// Wait for the console to be ready
					await app.workbench.positronConsole.waitForReady('>', 10000);
				}).toPass({ timeout: 50000 });

				logger.log('Test R Package');
				await expect(async () => {
					await app.workbench.quickaccess.runCommand('r.packageTest');
					await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.startsWith('[ FAIL 1 | WARN 0 | SKIP 0 | PASS 16 ]')));
				}).toPass({ timeout: 50000 });

				logger.log('Check R Package');
				await expect(async () => {
					await app.workbench.quickaccess.runCommand('r.packageCheck');
					await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.startsWith('Error: R CMD check found ERRORs')));
				}).toPass({ timeout: 50000 });

				logger.log('Install R Package and Restart R');
				await expect(async () => {
					await app.workbench.quickaccess.runCommand('r.packageInstall');
					await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.startsWith('✔ Installed testfun 0.0.0.9000')));
					await app.workbench.positronConsole.waitForReady('>');
					await app.workbench.positronConsole.waitForConsoleContents((contents) => contents.some((line) => line.includes('restarted')));
				}).toPass({ timeout: 50000 });
			});
		});
	});
}
