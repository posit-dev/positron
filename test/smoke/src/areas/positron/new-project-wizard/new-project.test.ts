/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('New Project Wizard', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python - New Project Wizard', () => {
			before(async function () {

			});

			it('Python Project Defaults', async function () {
				// TestRail #627912
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

			it('R Project Defaults', async function () {
				// TestRail #627913
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

		});

	});

	describe('New Project Wizard', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python - New Project Wizard', () => {
			before(async function () {

			});

			it('Jupyter Project Defaults', async function () {
				// TestRail #629352
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

