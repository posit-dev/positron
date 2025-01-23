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

test.describe('R - New Project Wizard', { tag: [tags.MODAL, tags.NEW_PROJECT_WIZARD, tags.WEB] }, () => {
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

	test('R - Cancel Renv install [C656252]', { tag: [tags.WIN] }, async function ({ app, packages }) {
		const projectTitle = addRandomNumSuffix('r-cancelRenvInstall');

		await packages.manage('renv', 'uninstall');
		await createNewProject(app, {
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'cancel');
		await verifyProjectCreation(app, projectTitle);
	});

});

test.describe('Jupyter - New Project Wizard', {
	tag: [tags.MODAL, tags.NEW_PROJECT_WIZARD],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5914' }], // uncomment line 103 when fixed
}, () => {
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
		await expect(app.code.driver.page.getByLabel('Folder Commands')).toHaveText(projectTitle, { timeout: 20000 });
		// await app.workbench.console.waitForReady('>', 30000); // issue 5914 causes this to fail
	});
}

async function verifyRenvFilesArePresent(app: Application,) {
	await test.step(`Verify renv files are present`, async () => {
		await app.workbench.explorer.verifyProjectFilesExist(['renv', '.Rprofile', 'renv.lock']);
	});
}

async function createNewProject(app: Application, options: CreateProjectOptions) {
	await test.step(`Create new project: ${options.title}`, async () => {
		await app.workbench.newProjectWizard.createNewProject(options);
	});
}

async function handleRenvInstallModal(app: Application, action: 'install' | 'cancel') {
	await test.step(`Handle Renv modal: ${action}`, async () => {
		await app.workbench.popups.installRenvModal(action);
	});
}

