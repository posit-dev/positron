/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, CreateProjectOptions, ProjectType } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// Not running conda test on windows because conda reeks havoc on selecting the correct python interpreter
test.describe('Python - New Project Wizard', { tag: [tags.NEW_PROJECT_WIZARD] }, () => {

	// This test relies on conda already being installed on the machine
	test('Create a new Conda environment [C628628]', async function ({ app }) {
		const projectTitle = addRandomNumSuffix('conda-installed');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			pythonEnv: 'Conda',
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyCondaFilesArePresent(app);
		await verifyCondaEnvStarts(app);
	});

	test('Create a new Venv environment [C627912]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('new-venv');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			pythonEnv: 'Venv',
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyVenEnvStarts(app);
	});

	// marie: wip
	test('With ipykernel already installed [C609619]', {
		tag: [tags.WIN],
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5730' }],
	}, async function ({ app, python }) {
		const projectTitle = addRandomNumSuffix('ipykernel-installed');

		// const interpreterInfo =
		// 	await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();
		// expect(interpreterInfo?.path).toBeDefined();
		// await app.workbench.interpreterDropdown.closeInterpreterDropdown();
		await ipykernel(app, 'install');

		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			pythonEnv: 'Existing',
		});

		await verifyProjectCreation(app, projectTitle);
		// 	const projSuffix = addRandomNumSuffix('_ipykernelInstalled');
		// 	const pw = app.workbench.newProjectWizard;
		// 	const pythonFixtures = new PythonFixtures(app);
		// 	// Start the Python interpreter and ensure ipykernel is installed
		// 	await pythonFixtures.startAndGetPythonInterpreter(true);

		// 	const interpreterInfo =
		// 		await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();
		// 	expect(interpreterInfo?.path).toBeDefined();
		// 	await app.workbench.interpreterDropdown.closeInterpreterDropdown();
		// 	// Create a new Python project and use the selected python interpreter
		// 	await pw.setProjectType(ProjectType.PYTHON_PROJECT);
		// 	await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// 	await pw.projectNameLocationStep.appendToProjectName(projSuffix);
		// 	await pw.navigate(ProjectWizardNavigateAction.NEXT);
		// 	await pw.pythonConfigurationStep.existingEnvRadioButton.click();
		// 	// Select the interpreter that was started above. It's possible that this needs
		// 	// to be attempted a few times to ensure the interpreters are properly loaded.
		// 	await expect(
		// 		async () =>
		// 			await pw.pythonConfigurationStep.selectInterpreterByPath(
		// 				interpreterInfo!.path
		// 			)
		// 	).toPass({
		// 		intervals: [1_000, 2_000, 10_000],
		// 		timeout: 50_000
		// 	});
		// await expect(pw.pythonConfigurationStep.interpreterFeedback).not.toBeVisible();
		// 	await pw.navigate(ProjectWizardNavigateAction.CREATE);
		// 	await pw.currentOrNewWindowSelectionModal.currentWindowButton.click();
		// 	await expect(page.getByRole('button', { name: `Explorer Section: ${defaultProjectName + projSuffix}` })).toBeVisible({ timeout: 20000 });
		// 	await expect(app.workbench.console.activeConsole.getByText('>>>')).toBeVisible({ timeout: 90000 });
	});

	test('With ipykernel not already installed [C609617]', {
		tag: [tags.WIN],
	}, async function ({ app, python }) {
		const projectTitle = addRandomNumSuffix('no-ipykernel');
		// const interpreterInfo =
		// 	await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();
		// expect(interpreterInfo?.path).toBeDefined();
		// await app.workbench.interpreterDropdown.closeInterpreterDropdown();
		// console.log('interperter info', interpreterInfo);
		await ipykernel(app, 'uninstall');

		// Create a new Python project and use the selected python interpreter
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			pythonEnv: 'Existing',
		});

		// Select the interpreter that was started above. It's possible that this needs
		// to be attempted a few times to ensure the interpreters are properly loaded.
		// 	await expect(
		// 		async () =>
		// 			await pw.pythonConfigurationStep.selectInterpreterByPath(
		// 				interpreterInfo!.path
		// 			)
		// 	).toPass({
		// 		intervals: [1_000, 2_000, 10_000],
		// 		timeout: 50_000
		// 	});
		// 	await expect(pw.pythonConfigurationStep.interpreterFeedback).toHaveText(
		// 		'ipykernel will be installed for Python language support.',
		// 		{ timeout: 10_000 }
		// 	);

		// 	// If ipykernel was successfully installed during the new project initialization,
		// 	// the console should be ready without any prompts to install ipykernel
		await verifyProjectCreation(app, projectTitle);
		await app.workbench.console.typeToConsole('pip show ipykernel', 10, true);
		await app.workbench.console.waitForConsoleContents('Name: ipykernel');

	});

	test('Default Python Project with git init [C674522]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('git-init');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			initAsGitRepo: true,
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyGitFilesArePresent(app);
		await verifyVenEnvStarts(app);
		await verifyGitStatus(app);
	});
});

// Helper functions
function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}

async function createNewProject(app: Application, options: CreateProjectOptions) {
	await test.step(`Create a new project: ${options.title}`, async () => {
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.PYTHON_PROJECT,
			title: options.title,
			pythonEnv: options.pythonEnv,
			initAsGitRepo: options.initAsGitRepo,
			rEnvCheckbox: options.rEnvCheckbox,
		});
	});
}

async function verifyProjectCreation(app: Application, projectTitle: string) {
	await test.step(`Verify project created: ${projectTitle}`, async () => {
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${projectTitle}` })).toBeVisible({ timeout: 15000 });
		await app.workbench.console.waitForReadyOrNoInterpreter();
	});
}

async function verifyCondaFilesArePresent(app: Application) {
	await test.step('Verify that the .conda files are present', async () => {
		const projectFiles = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		expect(projectFiles.getByText('.conda')).toBeVisible({ timeout: 50000 });
	});
}

async function verifyCondaEnvStarts(app: any) {
	await test.step('Verify that the conda environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Conda) started');
	});
}

async function verifyVenEnvStarts(app: any) {
	await test.step('Verify that the venv environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Venv: .venv) started.');
	});
}

async function verifyGitFilesArePresent(app: any) {
	await test.step('Verify that the .git files are present', async () => {
		const projectFiles = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		expect(projectFiles.getByText('.git')).toBeVisible({ timeout: 50000 });
		expect(projectFiles.getByText('.gitignore')).toBeVisible();
		// Ideally, we'd check for the .git folder, but it's not visible in the Explorer
		// by default due to the default `files.exclude` setting in the workspace.
	});
}

async function verifyGitStatus(app: any) {
	await test.step('Verify git status', async () => {
		// Git status should show that we're on the main branch
		await app.workbench.terminal.createTerminal();
		await app.workbench.terminal.runCommandInTerminal('git status');
		await app.workbench.terminal.waitForTerminalText('On branch main');
	});
}

async function ipykernel(app: any, action: 'install' | 'uninstall') {
	if (action === 'install') {
		await app.workbench.console.typeToConsole('pip install ipykernel', 10, true);
		await app.workbench.console.waitForConsoleContents('Note: you may need to restart the kernel to use updated packages.');
	} else if (action === 'uninstall') {
		await app.workbench.console.typeToConsole('pip uninstall -y ipykernel', 10, true);
		await app.workbench.console.waitForConsoleContents('Successfully uninstalled ipykernel');
		await app.workbench.console.typeToConsole('pip install packaging', 10, true); // why do I need to do this?
	}
}
