/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, CreateProjectOptions, ProjectType, } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.console.waitForReadyOrNoInterpreter();
	await app.workbench.layouts.enterLayout("stacked");
});

test.describe('R - New Project Wizard', { tag: [tags.NEW_PROJECT_WIZARD] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('R - Project Defaults [C627913]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('r-defaults');

		await createNewProject(app, {
			type: ProjectType.R_PROJECT,
			title: projectTitle
		});

		await verifyProjectCreation(app, projectTitle);
	});

	test('R - Accept Renv install [C633084]', { tag: [tags.WIN] }, async function ({ app, r, page }) {
		const projectTitle = addRandomNumSuffix('r-installRenv');

		await createNewProject(app, {
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'install');
		await verifyProjectCreation(app, projectTitle);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Renv already installed [C656251]', { tag: [tags.WIN] }, async function ({ app }) {
		// Renv will already be installed from the previous test - which is why tests are marked as "serial"
		const projectTitle = addRandomNumSuffix('r-renvAlreadyInstalled');
		await createNewProject(app, {
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install [C656252]', { tag: [tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('r-cancelRenvInstall');

		await removeRenvPackage(app);

		// Create a new R project - select Renv but opt out of installing
		await createNewProject(app, {
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'cancel');
		await verifyProjectCreation(app, projectTitle);
	});

});

test.describe('Jupyter - New Project Wizard', () => {
	test('Jupyter Project Defaults [C629352]', {
		tag: [tags.CRITICAL, tags.WIN],
	}, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('jupyter-defaults');
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.JUPYTER_NOTEBOOK,
			title: projectTitle
		});

		await verifyProjectCreation(app, projectTitle);
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}

async function verifyProjectCreation(app: Application, projectTitle: string) {
	await test.step(`Verify project created`, async () => {
		await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${projectTitle}` })).toBeVisible({ timeout: 15000 });
		await app.workbench.console.waitForReady('>');
	});
}

async function verifyRenvFilesArePresent(app: Application,) {
	// marie to do: update getProjectFiles()
	await test.step(`Verify renv files are present`, async () => {
		const projectFiles = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		expect(projectFiles.getByLabel('renv', { exact: true }).locator('a')).toBeVisible({ timeout: 50000 });
		expect(projectFiles.getByText('.Rprofile')).toBeVisible();
		expect(projectFiles.getByLabel('renv.lock', { exact: true }).locator('a')).toBeVisible();
	});
}

async function createNewProject(app: Application, options: CreateProjectOptions) {
	await test.step(`Create new project: ${options.title}`, async () => {
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.R_PROJECT,
			title: options.title,
			rEnvCheckbox: options.rEnvCheckbox,
		});
	});
}

async function handleRenvInstallModal(app: Application, action: 'install' | 'cancel') {
	await test.step(`Handle Renv modal: ${action}`, async () => {
		await app.workbench.popups.installRenvModal(action);
	});
}

async function removeRenvPackage(app: Application) {
	await test.step(`Remove renv package`, async () => {
		await app.workbench.console.executeCode('R', 'remove.packages("renv")', '>');
		await app.workbench.console.waitForConsoleContents(`Removing package`);
	});
}
