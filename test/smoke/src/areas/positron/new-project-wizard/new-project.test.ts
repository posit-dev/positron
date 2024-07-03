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

			it.only('R Project with Renv Environment', async function () {
				// TestRail #633...
				const app = this.app as Application;
				await app.workbench.positronNewProjectWizard.startNewProject();
				await app.workbench.positronNewProjectWizard.newRProjectButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardDisabledCreateButton.isNotVisible(500); // May need to pass in a retry count > default of 200
				// Select the Renv checkbox
				await app.workbench.positronNewProjectWizard.projectWizardRenvCheckbox.click();
				await app.workbench.positronNewProjectWizard.projectWizardNextButton.click();
				await app.workbench.positronNewProjectWizard.projectWizardCurrentWindowButton.click();
				await app.workbench.positronExplorer.explorerProjectTitle.waitForText('myRProject');
				await app.workbench.positronPopups.installRenv();
				// Verify renv files are present
				const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
				expect(projectFiles).toContain('renv');
				expect(projectFiles).toContain('.Rprofile');
				expect(projectFiles).toContain('renv.lock');
				// Run `renv::status()` in the console to confirm no issues
				await app.workbench.positronConsole.executeCode('R', 'renv::status()', '>');
				await app.workbench.positronConsole.waitForEndingConsoleText('No issues found', true);
				await app.workbench.positronConsole.logConsoleContents();
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

