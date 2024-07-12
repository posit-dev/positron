/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

/*
 * New Project Wizard test cases
 */
export function setup(logger: Logger) {
	describe('New Project Wizard', () => {
		describe('Python - New Project Wizard', () => {
			// Shared before/after handling
			installAllHandlers(logger);

			before(async function () {

			});

			it('Python Project Defaults [C627912]', async function () {
				const app = this.app as Application;
				const pw = app.workbench.positronNewProjectWizard;
				await pw.startNewProject();
				await pw.projectTypeStep.pythonProjectButton.click();
				await pw.nextButton.click();
				await pw.nextButton.click();
				await pw.disabledCreateButton.isNotVisible(500);
				await pw.nextButton.click();
				await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myPythonProject');
				await app.workbench.positronConsole.waitForReady('>>>', 10000);
			});

			describe('Python Project with existing interpreter', () => {
				it('With ipykernel already installed [C609619]', async function () {
					const projSuffix = '_ipykernelInstalled';
					const app = this.app as Application;
					const pw = app.workbench.positronNewProjectWizard;
					const pythonFixtures = new PositronPythonFixtures(app);
					// Start the Python interpreter and ensure ipykernel is installed
					const interpreterInfo = await pythonFixtures.startAndGetPythonInterpreter(true);
					expect(interpreterInfo?.path).toBeDefined();
					// Create a new Python project and use the selected python interpreter
					await pw.startNewProject();
					await pw.projectTypeStep.pythonProjectButton.click();
					await pw.nextButton.click();
					await pw.projectNameLocationStep.appendToProjectName(projSuffix);
					await pw.nextButton.click();
					await pw.pythonConfigurationStep.existingEnvRadioButton.click();
					// Select the interpreter that was started above
					await pw.pythonConfigurationStep.selectInterpreterByPath(interpreterInfo!.path);
					await pw.pythonConfigurationStep.interpreterFeedback.isNotVisible();
					await pw.disabledCreateButton.isNotVisible(500);
					await pw.nextButton.click();
					await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myPythonProject${projSuffix}`
					);
					// The console should initialize without any prompts to install ipykernel
					await app.workbench.positronConsole.waitForReady('>>>', 10000);
				});
				it('With ipykernel not already installed [C609617]', async function () {
					const projSuffix = '_noIpykernel';
					const app = this.app as Application;
					const pw = app.workbench.positronNewProjectWizard;
					const pythonFixtures = new PositronPythonFixtures(app);
					// Start the Python interpreter and uninstall ipykernel
					const interpreterInfo = await pythonFixtures.startAndGetPythonInterpreter(true);
					expect(interpreterInfo?.path).toBeDefined();
					await app.workbench.positronConsole.typeToConsole('pip uninstall -y ipykernel');
					await app.workbench.positronConsole.sendEnterKey();
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes('Successfully uninstalled ipykernel'))
					);
					// Create a new Python project and use the selected python interpreter
					await pw.startNewProject();
					await pw.projectTypeStep.pythonProjectButton.click();
					await pw.nextButton.click();
					await pw.projectNameLocationStep.appendToProjectName(projSuffix);
					await pw.nextButton.click();
					// Choose the existing environment which does not have ipykernel
					await pw.pythonConfigurationStep.existingEnvRadioButton.click();
					// Select the interpreter that was started above
					await pw.pythonConfigurationStep.selectInterpreterByPath(interpreterInfo!.path);
					await pw.pythonConfigurationStep.interpreterFeedback.waitForText(
						'ipykernel will be installed for Python language support.'
					);
					await pw.disabledCreateButton.isNotVisible(500);
					await pw.nextButton.click();
					await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myPythonProject${projSuffix}`
					);
					// If ipykernel was successfully installed during the new project initialization,
					// the console should be ready without any prompts to install ipykernel
					await app.workbench.positronConsole.waitForReady('>>>', 10000);
				});
			});
		});

		describe('R - New Project Wizard', () => {
			// Shared before/after handling
			installAllHandlers(logger);

			before(async function () {

			});

			it('R Project Defaults [C627913]', async function () {
				const app = this.app as Application;
				const pw = app.workbench.positronNewProjectWizard;
				await pw.startNewProject();
				await pw.projectTypeStep.rProjectButton.click();
				await pw.nextButton.click();
				await pw.nextButton.click();
				await pw.disabledCreateButton.isNotVisible(500);
				await pw.nextButton.click();
				await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myRProject');
				// NOTE: For completeness, we probably want to await app.workbench.positronConsole.waitForReady('>', 10000);
				// here, but it's timing out in CI, so it is not included for now.
			});

			describe('R Project with Renv Environment', () => {
				it('Accept Renv install [C633084]', async function () {
					const projSuffix = '_installRenv';
					const app = this.app as Application;
					const pw = app.workbench.positronNewProjectWizard;
					// Create a new R project - select Renv and install
					await pw.startNewProject();
					await pw.projectTypeStep.rProjectButton.click();
					await pw.nextButton.click();
					await pw.projectNameLocationStep.appendToProjectName(projSuffix);
					await pw.nextButton.click();
					await pw.disabledCreateButton.isNotVisible(500);
					// Select the renv checkbox
					await pw.rConfigurationStep.renvCheckbox.click();
					await pw.nextButton.click();
					await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
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
					}).toPass({ timeout: 10000 });
					// Verify that renv output in the console confirms no issues occurred
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes('renv activated'))
					);
				});

				it('Renv already installed [C656251]', async function () {
					// Renv will already be installed from the previous test
					const projSuffix = '_renvAlreadyInstalled';
					const app = this.app as Application;
					const pw = app.workbench.positronNewProjectWizard;
					await pw.startNewProject();
					await pw.projectTypeStep.rProjectButton.click();
					await pw.nextButton.click();
					await pw.projectNameLocationStep.appendToProjectName(projSuffix);
					await pw.nextButton.click();
					await pw.disabledCreateButton.isNotVisible(500);
					// Select the renv checkbox
					await pw.rConfigurationStep.renvCheckbox.click();
					await pw.nextButton.click();
					await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
					await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
						`myRProject${projSuffix}`
					);
					// Verify renv files are present
					expect(async () => {
						const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
						expect(projectFiles).toContain('renv');
						expect(projectFiles).toContain('.Rprofile');
						expect(projectFiles).toContain('renv.lock');
					}).toPass({ timeout: 10000 });
					// Verify that renv output in the console confirms no issues occurred
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes('renv activated'))
					);
				});

				it('Cancel Renv install [C656252]', async function () {
					const projSuffix = '_cancelRenvInstall';
					const app = this.app as Application;
					const pw = app.workbench.positronNewProjectWizard;
					// Remove renv package so we are prompted to install it again
					await app.workbench.positronConsole.executeCode('R', 'remove.packages("renv")', '>');
					await app.workbench.positronConsole.waitForConsoleContents((contents) =>
						contents.some((line) => line.includes(`Removing package`))
					);
					// Create a new R project - select Renv but opt out of installing
					await pw.startNewProject();
					await pw.projectTypeStep.rProjectButton.click();
					await pw.nextButton.click();
					await pw.projectNameLocationStep.appendToProjectName(projSuffix);
					await pw.nextButton.click();
					await pw.disabledCreateButton.isNotVisible(500);
					// Select the renv checkbox
					await pw.rConfigurationStep.renvCheckbox.click();
					await pw.nextButton.click();
					await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
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
					}).toPass({ timeout: 10000 });
				});
			});
		});

		describe('Jupyter - New Project Wizard', () => {
			// Shared before/after handling
			installAllHandlers(logger);

			before(async function () {

			});

			it('Jupyter Project Defaults [C629352]', async function () {
				const app = this.app as Application;
				const pw = app.workbench.positronNewProjectWizard;
				await pw.startNewProject();
				await pw.projectTypeStep.jupyterNotebookButton.click();
				await pw.nextButton.click();
				await pw.nextButton.click();
				await pw.disabledCreateButton.isNotVisible(500);
				await pw.nextButton.click();
				await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myJupyterNotebook');
				// NOTE: For completeness, we probably want to await app.workbench.positronConsole.waitForReady('>>>', 10000);
				// here, but it's timing out in CI, so it is not included for now.
			});

		});

	});
}

