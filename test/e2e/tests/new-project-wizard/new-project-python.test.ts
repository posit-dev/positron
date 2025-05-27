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
// Not running uv either because it is not installed on windows for now
test.describe('Python - New Project Wizard', { tag: [tags.MODAL, tags.NEW_PROJECT_WIZARD, tags.WEB] }, () => {

	test('Existing env: ipykernel already installed', { tag: [tags.WIN], }, async function ({ app, sessions, python }) {
		const projectTitle = addRandomNumSuffix('ipykernel-installed');

		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			status: 'existing',
			ipykernelFeedback: 'hide',
			interpreterPath: (await sessions.getSelectedSessionInfo()).path
		});

		await verifyProjectCreation(app, projectTitle);
	});

	// untagged windows because we cannot find any way to copy text from the terminal now that its a canvas
	test('New env: Git initialized', { tag: [tags.CRITICAL] }, async function ({ app }) {
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

	test('New env: Conda environment', async function ({ app }) {
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

	test('New env: Venv environment', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
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

	test('Python Notebook Project - connects notebook to runtime on startup', async function ({ app }) {
		const projectTitle = `python-notebook-runtime-${Math.floor(Math.random() * 1000000)}`;

		// Create a new Python notebook project
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.JUPYTER_NOTEBOOK,
			title: projectTitle,
			status: 'new',
			pythonEnv: 'venv', // or 'conda' if that's your default
		});

		// Wait for the notebook editor to be visible
		const notebookEditorTab = app.code.driver.page.locator('[id="workbench.parts.editor"]').getByText('Untitled-1.ipynb', { exact: true });
		await expect(notebookEditorTab).toBeVisible();

		// Get the Python version from the session selector button
		const sessionSelectorButton = app.code.driver.page.getByRole('button', { name: 'Session Selector' });
		const sessionSelectorText = await sessionSelectorButton.textContent();
		// Extract the version number (e.g., '3.10.12') from the button text
		const versionMatch = sessionSelectorText && sessionSelectorText.match(/Python ([0-9]+\.[0-9]+\.[0-9]+)/);
		const pythonVersion = versionMatch ? versionMatch[1] : undefined;
		// Fail the test if we can't extract the version
		expect(pythonVersion, 'Python version should be present in session selector').toBeTruthy();

		// After the runtime starts up the kernel status should be replaced with the kernel name.
		// The kernel name should contain the Python version from the session selector
		// Only look within an 'a' tag with class 'kernel-label' to avoid false positives
		const kernelLabel = app.code.driver.page.locator('a.kernel-label');
		await expect(kernelLabel).toContainText(`Python ${pythonVersion}`);
		await expect(kernelLabel).toContainText('.venv');
	});

	test('New env: uv environment', { tag: [tags.CRITICAL] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('new-uv');

		await createNewProject(app, {
			type: ProjectType.PYTHON_PROJECT,
			title: projectTitle,
			status: 'new',
			pythonEnv: 'uv',  // test relies on uv already installed on machine
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyUvEnvStarts(app);
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
		await expect(app.code.driver.page.locator('#top-action-bar-current-working-folder')).toHaveText(projectTitle, { timeout: 60000 }); // this is really slow on windows CI for some reason
		await app.workbench.console.waitForReadyAndStarted('>>>', 90000);
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

async function verifyUvEnvStarts(app: Application) {
	await test.step('Verify uv environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Uv: .venv) started.');
	});
}

async function verifyGitFilesArePresent(app: Application) {
	await test.step('Verify that the .git files are present', async () => {
		const projectFiles = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		await expect(projectFiles.getByText('.git')).toBeVisible({ timeout: 50000 });
		await expect(projectFiles.getByText('.gitignore')).toBeVisible();
		// Ideally, we'd check for the .git folder, but it's not visible in the Explorer
		// by default due to the default `files.exclude` setting in the workspace.
	});
}

async function verifyGitStatus(app: Application) {
	await test.step('Verify git status', async () => {
		// Git status should show that we're on the main branch
		await app.workbench.terminal.createTerminal();
		await app.workbench.terminal.runCommandInTerminal('git status');
		await app.workbench.terminal.waitForTerminalText('On branch main', { web: app.web });
	});
}
