/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronPythonFixtures, ProjectType, ProjectWizardNavigateAction } from '../../../../../automation';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});
// MARIE: REMOVE PR TAG
test.describe('Python - New Project Wizard', { tag: ['@marie'] }, () => {
	test.slow();

	test('With ipykernel already installed [C609619]', async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_ipykernelInstalled');
		const pw = app.workbench.positronNewProjectWizard;
		const pythonFixtures = new PositronPythonFixtures(app);
		// Start the Python interpreter and ensure ipykernel is installed
		await pythonFixtures.startAndGetPythonInterpreter(true);
		// Ensure the console is ready with the selected interpreter
		await app.workbench.positronConsole.waitForReady('>>>', 10000);
		const interpreterInfo =
			await app.workbench.positronInterpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo?.path).toBeDefined();
		await app.workbench.positronInterpreterDropdown.closeInterpreterDropdown();
		// Create a new Python project and use the selected python interpreter
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.pythonConfigurationStep.existingEnvRadioButton.click();
		// Select the interpreter that was started above. It's possible that this needs
		// to be attempted a few times to ensure the interpreters are properly loaded.
		await expect(
			async () =>
				await pw.pythonConfigurationStep.selectInterpreterByPath(
					interpreterInfo!.path
				)
		).toPass({
			intervals: [1_000, 2_000, 10_000],
			timeout: 50_000
		});
		await expect(pw.pythonConfigurationStep.interpreterFeedback).not.toBeVisible();
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
			`myPythonProject${projSuffix}`
		);
		// The console should initialize without any prompts to install ipykernel
		await app.workbench.positronConsole.waitForReady('>>>', 10000);
	});

	test('With ipykernel not already installed [C609617]', async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_noIpykernel');
		const pw = app.workbench.positronNewProjectWizard;
		const pythonFixtures = new PositronPythonFixtures(app);
		// Start the Python interpreter and uninstall ipykernel
		await pythonFixtures.startAndGetPythonInterpreter(true);
		// Ensure the console is ready with the selected interpreter
		await app.workbench.positronConsole.waitForReady('>>>', 10000);
		const interpreterInfo =
			await app.workbench.positronInterpreterDropdown.getSelectedInterpreterInfo();
		expect(interpreterInfo?.path).toBeDefined();
		await app.workbench.positronInterpreterDropdown.closeInterpreterDropdown();
		await app.workbench.positronConsole.typeToConsole('pip uninstall -y ipykernel');
		await app.workbench.positronConsole.sendEnterKey();
		await app.workbench.positronConsole.waitForConsoleContents((contents) =>
			contents.some((line) => line.includes('Successfully uninstalled ipykernel'))
		);
		// Create a new Python project and use the selected python interpreter
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// Choose the existing environment which does not have ipykernel
		await pw.pythonConfigurationStep.existingEnvRadioButton.click();
		// Select the interpreter that was started above. It's possible that this needs
		// to be attempted a few times to ensure the interpreters are properly loaded.
		await expect(
			async () =>
				await pw.pythonConfigurationStep.selectInterpreterByPath(
					interpreterInfo!.path
				)
		).toPass({
			intervals: [1_000, 2_000, 10_000],
			timeout: 50_000
		});
		await expect(pw.pythonConfigurationStep.interpreterFeedback).toHaveText(
			'ipykernel will be installed for Python language support.',
			{ timeout: 10_000 }
		);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
			`myPythonProject${projSuffix}`
		);
		// If ipykernel was successfully installed during the new project initialization,
		// the console should be ready without any prompts to install ipykernel
		await app.workbench.positronConsole.waitForReady('>>>', 10000);
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('Default Python Project with git init [C674522]', { tag: ['@pr', '@win'] }, async function ({ app }) {
		const projSuffix = addRandomNumSuffix('_gitInit');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);

		// Check the git init checkbox
		await pw.projectNameLocationStep.gitInitCheckbox.waitFor();
		await pw.projectNameLocationStep.gitInitCheckbox.setChecked(true);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);

		// Open the new project in the current window and wait for the console to be ready
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await app.workbench.positronExplorer.explorerProjectTitle.waitForText(
			`myPythonProject${projSuffix}`
		);
		await app.workbench.positronConsole.waitForReady('>>>', 10000);

		// Verify git-related files are present
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('.gitignore');
			expect(projectFiles).toContain('README.md');
			// Ideally, we'd check for the .git folder, but it's not visible in the Explorer
			// by default due to the default `files.exclude` setting in the workspace.
		}).toPass({ timeout: 50000 });

		// Git status should show that we're on the main branch
		await app.workbench.terminal.createTerminal();
		await app.workbench.terminal.runCommandInTerminal('git status');
		await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('On branch main')));
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}
