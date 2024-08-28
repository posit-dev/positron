/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import path = require('path');
import { Application, Logger, PositronRFixtures, PositronUserSettingsFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('Test Explorer', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;
		let userSettings: PositronUserSettingsFixtures;

		describe('Test Explorer - R', () => {
			before(async function () {
				app = this.app as Application;

				try {

					await PositronRFixtures.SetupFixtures(this.app as Application);

					userSettings = new PositronUserSettingsFixtures(app);

					// don't use native file picker
					await userSettings.setUserSetting([
						'files.simpleDialog.enable',
						'true',
					]);

					await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
					await app.workbench.positronConsole.barClearButton.click();
					await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');

				} catch (e) {
					this.app.code.driver.takeScreenshot('testExplorerSetup');
					throw e;
				}
			});

			after(async function () {

				// unset the use of the VSCode file picker
				await userSettings.unsetUserSettings();

			});

			it('R - Verify Basic Test Explorer Functionality [C749378]', async function () {

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

				await expect(async () => {
					await app.workbench.positronTestExplorer.clickTestExplorerIcon();

					const projectFiles = await app.workbench.positronTestExplorer.getTestExplorerFiles();

					// test-mathstuff.R is the last section of tests in https://github.com/posit-dev/qa-example-content/tree/main/workspaces/r_testing
					expect(projectFiles).toContain('test-mathstuff.R');
				}).toPass({ timeout: 50000 });

				await app.workbench.positronTestExplorer.runAllTests();

				await expect(async () => {
					const testResults = await app.workbench.positronTestExplorer.getTestResults();

					expect(testResults[0].caseText).toBe('nothing really');
					expect(testResults[0].status).toBe('fail');

					expect(testResults[1].caseText).toBe('subtraction works');
					expect(testResults[1].status).toBe('pass');

					expect(testResults[2].caseText).toBe('subtraction `still` "works"');
					expect(testResults[2].status).toBe('pass');

					expect(testResults[3].caseText).toBe('x is \'a\'');
					expect(testResults[3].status).toBe('pass');

					expect(testResults[4].caseText).toBe('x is \'a\' AND y is \'b\'');
					expect(testResults[4].status).toBe('pass');

					expect(testResults[5].caseText).toBe('whatever');
					expect(testResults[5].status).toBe('pass');

					expect(testResults[6].caseText).toBe('can \'add\' two numbers');
					expect(testResults[6].status).toBe('pass');

					expect(testResults[7].caseText).toBe('can multiply two numbers');
					expect(testResults[7].status).toBe('pass');

					expect(testResults[8].caseText).toBe('can be multiplied by a scalar');
					expect(testResults[8].status).toBe('pass');

					expect(testResults[9].caseText).toBe('is true');
					expect(testResults[9].status).toBe('pass');

					expect(testResults[10].caseText).toBe('can add two numbers');
					expect(testResults[10].status).toBe('pass');

					expect(testResults[11].caseText).toBe('can multiply two numbers');
					expect(testResults[11].status).toBe('pass');

					expect(testResults[12].caseText).toBe('a second it()');
					expect(testResults[12].status).toBe('pass');
				}).toPass({ timeout: 50000 });

			});
		});
	});
}
