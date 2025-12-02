/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, CreateFolderOptions, FolderTemplate } from '../../../infra/index.js';
import { expect, test } from '../../_test.setup.js';

export function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}

export async function createNewFolder(app: Application, options: CreateFolderOptions) {
	await test.step(`Create a new folder: ${options.folderName}`, async () => {
		await app.workbench.newFolderFlow.createNewFolder(options);
	});
}

export async function verifyFolderCreation(app: Application, folderName: string) {
	await test.step(`Verify folder created`, async () => {
		await expect(app.code.driver.page.locator('#top-action-bar-current-working-folder')).toHaveText(folderName, { timeout: 60000 }); // this is really slow on windows CI for some reason
	});
}

export async function verifyConsoleReady(app: Application, folderTemplate: FolderTemplate) {
	await test.step(`Verify console is ready`, async () => {
		const consoleSymbol = folderTemplate === FolderTemplate.R_PROJECT ? '>' : '>>>';
		await app.workbench.console.waitForReadyAndStarted(consoleSymbol, 90000);
	});
}

export async function verifyGitFilesArePresent(app: Application) {
	await test.step('Verify that the .git files are present', async () => {
		await app.workbench.explorer.verifyExplorerFilesExist(['.git', '.gitignore']);
	});
}

export async function verifyGitStatus(app: Application) {
	await test.step('Verify git status', async () => {
		// Git status should show that we're on the main branch
		await app.workbench.terminal.createTerminal();
		await app.workbench.terminal.runCommandInTerminal('git status');
		await app.workbench.terminal.waitForTerminalText('On branch main');
	});
}

export async function verifyRenvFilesArePresent(app: Application,) {
	await test.step(`Verify renv files are present`, async () => {
		await app.workbench.explorer.verifyExplorerFilesExist(['renv', '.Rprofile', 'renv.lock']);
	});
}

export async function handleRenvInstallModal(app: Application, action: 'install' | 'cancel') {
	await test.step(`Handle Renv modal: ${action}`, async () => {
		await app.workbench.modals.installRenvModal(action);
	});
}

export async function verifyCondaFilesArePresent(app: Application) {
	await test.step('Verify .conda files are present', async () => {
		await app.workbench.explorer.verifyExplorerFilesExist(['.conda']);
	});
}

export async function verifyCondaEnvStarts(app: Application) {
	await test.step('Verify conda environment starts', async () => {
		await app.workbench.console.waitForConsoleContents(/(Conda).*started/);
	});
}

export async function verifyVenvEnvStarts(app: Application) {
	await test.step('Verify venv environment starts', async () => {
		await app.workbench.console.waitForConsoleContents('(Venv: .venv) started.');
	});
}

export async function verifyUvEnvStarts(app: Application) {
	await test.step('Verify uv environment starts', async () => {
		if (/(8080)/.test(app.code.driver.page.url())) {
			app.code.driver.page.getByRole('button', { name: 'Yes' }).click();
		}
		await app.workbench.console.waitForConsoleContents(/(Uv: .+) started./);
	});
}

export async function verifyPyprojectTomlCreated(app: Application) {
	await test.step('Verify pyproject.toml file is created', async () => {
		const files = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		await expect(files.getByText('pyproject.toml')).toBeVisible({ timeout: 50000 });
	});
}

export async function verifyPyprojectTomlNotCreated(app: Application) {
	await test.step('Verify pyproject.toml file is not created', async () => {
		const files = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		await expect(files.getByText('pyproject.toml')).toHaveCount(0, { timeout: 50000 });
	});
}
