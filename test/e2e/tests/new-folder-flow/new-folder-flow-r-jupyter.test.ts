/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, CreateFolderOptions, FolderTemplate, } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app, sessions }) {
	await sessions.expectAllSessionsToBeReady();
	await app.workbench.layouts.enterLayout("stacked");
});

test.describe('R - New Folder Flow', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('R - Folder Defaults', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('r-defaults');

		await createNewFolder(app, {
			folderTemplate: FolderTemplate.R_PROJECT,
			folderName
		});

		await verifyFolderCreation(app, folderName);
	});

	test('R - Accept Renv install', { tag: [tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('r-installRenv');

		await createNewFolder(app, {
			folderTemplate: FolderTemplate.R_PROJECT,
			folderName,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'install');
		await verifyFolderCreation(app, folderName);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Renv already installed', { tag: [tags.WIN] }, async function ({ app }) {
		// Renv will already be installed from the previous test - which is why tests are marked as "serial"
		const folderName = addRandomNumSuffix('r-renvAlreadyInstalled');
		await createNewFolder(app, {
			folderTemplate: FolderTemplate.R_PROJECT,
			folderName,
			rEnvCheckbox: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install', { tag: [tags.WIN] }, async function ({ app, packages }) {
		const folderName = addRandomNumSuffix('r-cancelRenvInstall');

		await packages.manage('renv', 'uninstall');
		await createNewFolder(app, {
			folderTemplate: FolderTemplate.R_PROJECT,
			folderName,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'cancel');
		await verifyFolderCreation(app, folderName);
	});

});

test.describe('Jupyter - New Folder Flow', {
	tag: [tags.MODAL, tags.NEW_FOLDER_FLOW],
	annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/5914' }], // uncomment line 103 when fixed
}, () => {
	test('Jupyter Folder Defaults', {
		tag: [tags.CRITICAL, tags.WIN],
	}, async function ({ app }) {
		const folderName = addRandomNumSuffix('jupyter-defaults');
		await app.workbench.newFolderFlow.createNewFolder({
			folderTemplate: FolderTemplate.JUPYTER_NOTEBOOK,
			folderName
		});

		await verifyFolderCreation(app, folderName, false);
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}

async function verifyFolderCreation(app: Application, folderName: string, waitForReady = true) {
	await test.step(`Verify folder created`, async () => {
		await expect(app.code.driver.page.locator('#top-action-bar-current-working-folder')).toHaveText(folderName, { timeout: 20000 });

		if (waitForReady) {
			await app.workbench.console.waitForReady('>', 30000); // issue 5914 causes this to fail for Jupyter notebooks
		}
	});
}

async function verifyRenvFilesArePresent(app: Application,) {
	await test.step(`Verify renv files are present`, async () => {
		await app.workbench.explorer.verifyExplorerFilesExist(['renv', '.Rprofile', 'renv.lock']);
	});
}

async function createNewFolder(app: Application, options: CreateFolderOptions) {
	await test.step(`Create new folder: ${options.folderName}`, async () => {
		await app.workbench.newFolderFlow.createNewFolder(options);
	});
}

async function handleRenvInstallModal(app: Application, action: 'install' | 'cancel') {
	await test.step(`Handle Renv modal: ${action}`, async () => {
		await app.workbench.popups.installRenvModal(action);
	});
}

