/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronPythonFixtures, ProjectType, ProjectWizardNavigateAction } from '../../../automation';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.positronConsole.waitForReadyOrNoInterpreter();
});

// Not running conda test on windows becuase conda reeks havoc on selecting the correct python interpreter
test.describe('Python - New Project Wizard', { tag: [tags.NEW_PROJECT_WIZARD] }, () => {
	const defaultProjectName = 'my-python-project';

	test('Create a new Conda environment [C628628]', async function ({ app, page }) {
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
		await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });
		// Check that the `.conda` folder gets created in the project
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('.conda');
		}).toPass({ timeout: 50000 });
		// The console should initialize without any prompts to install ipykernel
		await expect(app.workbench.positronConsole.activeConsole.getByText('>>>')).toBeVisible({ timeout: 45000 });
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('Create a new Venv environment [C627912]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app, page }) {
		// This is the default behavior for a new Python Project in the Project Wizard
		const projSuffix = addRandomNumSuffix('_new_venv');
		const pw = app.workbench.positronNewProjectWizard;
		await pw.startNewProject(ProjectType.PYTHON_PROJECT);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		await pw.navigate(ProjectWizardNavigateAction.NEXT);
		await pw.navigate(ProjectWizardNavigateAction.CREATE);
		await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });
		await expect(app.workbench.positronConsole.activeConsole.getByText('>>>')).toBeVisible({ timeout: 100000 });
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	// Skip test due to https://github.com/posit-dev/positron/issues/5730. Both have to skipped as they depend o
	test.skip('With ipykernel already installed [C609619]', {
		tag: [tags.WIN],
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5730' }],
	}, async function ({ app, page, python }) {
		const projSuffix = addRandomNumSuffix('_ipykernelInstalled');
		const pw = app.workbench.positronNewProjectWizard;
		const pythonFixtures = new PositronPythonFixtures(app);
		// Start the Python interpreter and ensure ipykernel is installed
		await pythonFixtures.startAndGetPythonInterpreter(true);

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
		await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });
		await expect(app.workbench.positronConsole.activeConsole.getByText('>>>')).toBeVisible({ timeout: 90000 });
	});

	test.skip('With ipykernel not already installed [C609617]', {
		tag: [tags.WIN],
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5730' }],
	}, async function ({ app, page }) {
		const projSuffix = addRandomNumSuffix('_noIpykernel');
		const pw = app.workbench.positronNewProjectWizard;
		const pythonFixtures = new PositronPythonFixtures(app);
		// Start the Python interpreter and uninstall ipykernel
		await pythonFixtures.startAndGetPythonInterpreter(true);

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
		await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });

		// If ipykernel was successfully installed during the new project initialization,
		// the console should be ready without any prompts to install ipykernel
		await expect(app.workbench.positronConsole.activeConsole.getByText('>>>')).toBeVisible({ timeout: 90000 });
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('Default Python Project with git init [C674522]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app, page }) {
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
		await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });
		await expect(app.workbench.positronConsole.activeConsole.getByText('>>>')).toBeVisible({ timeout: 90000 });

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
