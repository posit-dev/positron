/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProjectType, ProjectWizardNavigateAction } from '../../../automation';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.positronConsole.waitForReadyOrNoInterpreter();
	await app.workbench.positronLayouts.enterLayout("stacked");
});

test.describe('R - New Project Wizard', { tag: [tags.NEW_PROJECT_WIZARD] }, () => {
	test.describe.configure({ mode: 'serial' });

	const defaultProjectName = 'my-r-project';

	test('R - Project Defaults [C627913]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_defaults');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.R_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronLayouts.enterLayout("fullSizedSidebar");
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 15000 });
		// NOTE: For completeness, we probably want to await app.workbench.positronConsole.waitForReady('>', 10000);
		// here, but it's timing out in CI, so it is not included for now.
	});

	test('R - Accept Renv install [C633084]', { tag: [tags.WIN] }, async function ({ app, r }) {
		const projSuffix = addRandomNumSuffix('_installRenv');
		const pw = app.workbench.positronNewProjectWizard;
		// Create a new R project - select Renv and install
		await pw.startNewProject(ProjectType.R_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// Select the renv checkbox
		await pw.rConfigurationStep.renvCheckbox.click();
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();

		// Interact with the modal to install renv
		await app.workbench.positronPopups.installRenv();

		// If this test is running on a machine that is using Renv for the first time, we
		// may need to interact with the Console to allow the renv installation to complete
		// An example: https://github.com/posit-dev/positron/pull/3881#issuecomment-2211123610.

		// You should either manually interact with the Console to proceed with the Renv
		// install or temporarily uncomment the code below to automate the interaction.
		// await app.workbench.positronConsole.waitForConsoleContents('Do you want to proceed?')
		// await app.workbench.positronConsole.typeToConsole('y');
		// await app.workbench.positronConsole.sendEnterKey();

		await app.workbench.positronLayouts.enterLayout("fullSizedSidebar");
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 15000 });
		// Verify renv files are present
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('renv');
			expect(projectFiles).toContain('.Rprofile');
			expect(projectFiles).toContain('renv.lock');
		}).toPass({ timeout: 50000 });
		// Verify that renv output in the console confirms no issues occurred
		await app.workbench.positronConsole.waitForConsoleContents('renv activated');
	});

	test('R - Renv already installed [C656251]', { tag: [tags.WIN] }, async function ({ app }) {
		// Renv will already be installed from the previous test - which is why tests are marked as "serial"
		const projSuffix = addRandomNumSuffix('_renvAlreadyInstalled');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.R_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// Select the renv checkbox
		await pw.rConfigurationStep.renvCheckbox.click();
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 15000 });
		// Verify renv files are present
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('renv');
			expect(projectFiles).toContain('.Rprofile');
			expect(projectFiles).toContain('renv.lock');
		}).toPass({ timeout: 50000 });
		// Verify that renv output in the console confirms no issues occurred
		await app.workbench.positronConsole.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install [C656252]', { tag: [tags.WIN] }, async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_cancelRenvInstall');
		const pw = app.workbench.positronNewProjectWizard;
		// Remove renv package so we are prompted to install it again
		await app.workbench.positronConsole.executeCode('R', 'remove.packages("renv")', '>');
		await app.workbench.positronConsole.waitForConsoleContents(`Removing package`);
		// Create a new R project - select Renv but opt out of installing
		await pw.startNewProject(ProjectType.R_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// Select the renv checkbox
		await pw.rConfigurationStep.renvCheckbox.click();
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 15000 });
		// Interact with the modal to skip installing renv
		await app.workbench.positronPopups.installRenv(false);
		// Verify renv files are **not** present
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).not.toContain('renv');
			expect(projectFiles).not.toContain('.Rprofile');
			expect(projectFiles).not.toContain('renv.lock');
		}).toPass({ timeout: 50000 });
	});

});

test.describe('Jupyter - New Project Wizard', () => {
	const defaultProjectName = 'my-jupyter-notebook';

	test.skip('Jupyter Project Defaults [C629352]', {
		tag: [tags.CRITICAL, tags.WIN],
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5730' }],
	}, async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_defaults');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.JUPYTER_NOTEBOOK);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.code.driver.wait(10000);
		await app.workbench.positronLayouts.enterLayout("fullSizedSidebar");
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 15000 });
		// NOTE: For completeness, we probably want to await app.workbench.positronConsole.waitForReady('>>>', 10000);
		// here, but it's timing out in CI, so it is not included for now.
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}
