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

	test('Create a new Conda environment [C628628]', async function ({ app }) {
		const projectTitle = addRandomNumSuffix('conda-installed');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			status: 'new',
			pythonEnv: 'conda', // test relies on conda already installed on machine
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
			status: 'new',
			pythonEnv: 'venv',
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyVenEnvStarts(app);
	});

	test('With ipykernel already installed [C609619]', { tag: [tags.WIN], }, async function ({ app, python, packages }) {
		const projectTitle = addRandomNumSuffix('ipykernel-installed');

		await packages.manage('ipykernel', 'install');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			status: 'existing',
			ipykernelFeedback: 'hide',
			interpreterPath: await getInterpreterPath(app),
		});

		await verifyProjectCreation(app, projectTitle);
	});

	test('With ipykernel not already installed [C609617]', { tag: [tags.WIN] }, async function ({ app, python, packages }) {
		const projectTitle = addRandomNumSuffix('no-ipykernel');

		await packages.manage('ipykernel', 'uninstall');
		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			status: 'existing',
			interpreterPath: await getInterpreterPath(app),
			ipykernelFeedback: 'show'
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyIpykernelInstalled(app);
	});

	test('Default Python Project with git init [C674522]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('git-init');

		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			initAsGitRepo: true,
			status: 'new',
			pythonEnv: 'venv',
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
		await app.workbench.newProjectWizard.createNewProject(options);
	});
}

async function verifyProjectCreation(app: Application, projectTitle: string) {
	await test.step(`Verify project created`, async () => {
		await expect(app.code.driver.page.getByLabel('Folder Commands')).toHaveText(projectTitle, { timeout: 60000 }); // this is really slow on windows CI for some reason
		await app.workbench.console.waitForReady('>>>', 60000);
	});
}

async function verifyCondaFilesArePresent(app: Application) {
	await test.step('Verify .conda files are present', async () => {
		await app.workbench.explorer.verifyProjectFilesExist(['.conda']);
	});
}

async function verifyCondaEnvStarts(app: Application) {
	await test.step('Verify conda environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Conda) started');
	});
}

async function verifyVenEnvStarts(app: Application) {
	await test.step('Verify venv environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Venv: .venv) started.');
	});
}

async function verifyGitFilesArePresent(app: Application) {
	await test.step('Verify that the .git files are present', async () => {
		const projectFiles = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		expect(projectFiles.getByText('.git')).toBeVisible({ timeout: 50000 });
		expect(projectFiles.getByText('.gitignore')).toBeVisible();
		// Ideally, we'd check for the .git folder, but it's not visible in the Explorer
		// by default due to the default `files.exclude` setting in the workspace.
	});
}

async function verifyGitStatus(app: Application) {
	await test.step('Verify git status', async () => {
		// Git status should show that we're on the main branch
		await app.workbench.terminal.createTerminal();
		await app.workbench.terminal.runCommandInTerminal('git status');
		await app.workbench.terminal.waitForTerminalText('On branch main');
	});
}


async function verifyIpykernelInstalled(app: Application) {
	await test.step('Verify ipykernel is installed', async () => {
		await app.workbench.console.typeToConsole('pip show ipykernel', 10, true);
		await app.workbench.console.waitForConsoleContents('Name: ipykernel');
	});
}

async function getInterpreterPath(app: Application): Promise<string> {
	let interpreterPath: string | undefined;

	await test.step('Get the interpreter path', async () => {
		const interpreterInfo =
			await app.workbench.interpreterDropdown.getSelectedInterpreterInfo();

		expect(interpreterInfo?.path).toBeDefined();
		interpreterPath = interpreterInfo?.path;
	});

	if (!interpreterPath) {
		throw new Error('Interpreter path is undefined');
	}

	return interpreterPath;
}
