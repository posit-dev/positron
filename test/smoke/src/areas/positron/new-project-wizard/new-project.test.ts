/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * New Project Wizard test cases
 */
export function setup(logger: Logger) {
	describe('New Project Wizard', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python - New Project Wizard', () => {
			before(async function () {

			});

			it('Python Project Defaults [C627912]', async function () {
				const app = this.app as Application;
				await app.workbench.positronNewProjectWizard.startNewProject();
				await app.workbench.positronNewProjectWizard.newPythonProjectButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myPythonProject');
			});

		});

	});

	describe('New Project Wizard', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('R - New Project Wizard', () => {
			before(async function () {

			});

			it('R Project Defaults [C627913]', async function () {
				const app = this.app as Application;
				await app.workbench.positronNewProjectWizard.startNewProject();
				await app.workbench.positronNewProjectWizard.newRProjectButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myRProject');
			});

			describe('R Project with Renv Environment', () => {
				it('Accept Renv install [C633084]', async function () {
					const projSuffix = '_installRenv';
					const app = this.app as Application;
					// Create a new R project - select Renv and install
					await app.workbench.positronNewProjectWizard.startNewProject();
					await app.workbench.positronNewProjectWizard.newRProjectButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardProjectNameInput
						.getPage()
						.keyboard.insertText(projSuffix);
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
					// Select the renv checkbox
					await app.workbench.positronNewProjectWizard.projectWizardRenvCheckbox.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myRProject${projSuffix}`
					);
					// Interact with the modal to install renv
					await app.workbench.positronPopups.installRenv();

					// If the test is running on Windows, we may need to interact with the
					// Console to allow the renv installation to complete. It doesn't always happen,
					// so for now this code is commented out. We've seen it once, but not again:
					// https://github.com/posit-dev/positron/pull/3881#issuecomment-2211123610.
					// For some reason, we don't need to do this on Mac or Linux -- or at least we
					// haven't seen it yet!
					// if (process.platform === 'win32') {
					// 	await app.workbench.positronConsole.waitForConsoleContents((contents) =>
					// 		contents.some((line) => line.includes('Do you want to proceed?'))
					// 	);
					// 	await app.workbench.positronConsole.typeToConsole('y');
					// 	await app.workbench.positronConsole.sendEnterKey();
					// }

					// Verify renv files are present
					expect(async () => {
						const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
						expect(projectFiles).toContain('renv');
						expect(projectFiles).toContain('.Rprofile');
						expect(projectFiles).toContain('renv.lock');
					}).toPass({timeout: 10000});
					// Verify that renv output in the console confirms no issues occurred
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes('renv activated'))
					);
				});

				it('Renv already installed [C656251]', async function () {
					// Renv will already be installed from the previous test
					const projSuffix = '_renvAlreadyInstalled';
					const app = this.app as Application;
					await app.workbench.positronNewProjectWizard.startNewProject();
					await app.workbench.positronNewProjectWizard.newRProjectButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardProjectNameInput
						.getPage()
						.keyboard.insertText(projSuffix);
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
					// Select the renv checkbox
					await app.workbench.positronNewProjectWizard.projectWizardRenvCheckbox.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myRProject${projSuffix}`
					);
					// Verify renv files are present
					expect(async () => {
						const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
						expect(projectFiles).toContain('renv');
						expect(projectFiles).toContain('.Rprofile');
						expect(projectFiles).toContain('renv.lock');
					}).toPass({timeout: 10000});
					// Verify that renv output in the console confirms no issues occurred
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes('renv activated'))
				);
				});

				it('Cancel Renv install [C656252]', async function () {
					const projSuffix = '_cancelRenvInstall';
					const app = this.app as Application;
					// Remove renv package so we are prompted to install it again
					await app.workbench.positronConsole.executeCode('R', 'remove.packages("renv")', '>');
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes(`Removing package`))
					);
					// Create a new R project - select Renv but opt out of installing
					await app.workbench.positronNewProjectWizard.startNewProject();
					await app.workbench.positronNewProjectWizard.newRProjectButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardProjectNameInput
						.getPage()
						.keyboard.insertText(projSuffix);
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
					// Select the renv checkbox
					await app.workbench.positronNewProjectWizard.projectWizardRenvCheckbox.click();
					await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
					await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myRProject${projSuffix}`
					);
					// Interact with the modal to skip installing renv
					await app.workbench.positronPopups.installRenv(false);
					// Verify renv files are **not** present
					expect(async () => {
						const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
						expect(projectFiles).not.toContain('renv');
						expect(projectFiles).not.toContain('.Rprofile');
						expect(projectFiles).not.toContain('renv.lock');
					}).toPass({timeout: 10000});
				});
			});
		});
	});

	describe('New Project Wizard', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python - New Project Wizard', () => {
			before(async function () {

			});

			it('Jupyter Project Defaults [C629352]', async function () {
				const app = this.app as Application;
				await app.workbench.positronNewProjectWizard.startNewProject();
				await app.workbench.positronNewProjectWizard.newJupyterProjectButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myJupyterNotebook');
			});

		});

	});
}

