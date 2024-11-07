/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProjectType, ProjectWizardNavigateAction } from '../../../../../automation';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Python - New Project Wizard', () => {
	test('Create a new Venv environment [C627912]', { tag: ['@pr'] }, async function ({ app }) {
		// This is the default behavior for a new Python Project in the Project Wizard
		const projSuffix = addRandomNumSuffix('_new_venv');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText(`myPythonProject${projSuffix}`);
		await app.workbench.positronConsole.waitForReady('>>>', 10000);
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('Create a new Conda environment [C628628]', async function ({ app }) {
		// This test relies on Conda already being installed on the machine
		test.slow();
		const projSuffix = addRandomNumSuffix('_condaInstalled');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// Select 'Conda' as the environment provider
		await pw.pythonConfigurationStep.selectEnvProvider('Conda');
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
			`myPythonProject${projSuffix}`
		);
		// Check that the `.conda` folder gets created in the project
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('.conda');
		}).toPass({ timeout: 50000 });
		// The console should initialize without any prompts to install ipykernel
		await app.workbench.positronConsole.waitForReady('>>>', 40000);
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}
