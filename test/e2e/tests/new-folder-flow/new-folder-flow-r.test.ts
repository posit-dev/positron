/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderTemplate, } from '../../infra';
import { test, tags } from '../_test.setup';
import { addRandomNumSuffix, createNewFolder, handleRenvInstallModal, verifyConsoleReady, verifyFolderCreation, verifyRenvFilesArePresent, verifyPyprojectTomlNotCreated } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app, sessions }) {
	await sessions.expectAllSessionsToBeReady();
	await app.positron.layouts.enterLayout("stacked");
});

test.describe('New Folder Flow: R Project', { tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB, tags.ARK] }, () => {
	test.describe.configure({ mode: 'serial' });
	const folderTemplate = FolderTemplate.R_PROJECT;

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 5000 });
	});

	test('R - Folder Defaults', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app, settings }) {
		const folderName = addRandomNumSuffix('r-defaults');

		await createNewFolder(app, {
			folderTemplate,
			folderName
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyPyprojectTomlNotCreated(app);
	});

	test('R - Accept Renv install', { tag: [tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('r-installRenv');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'install');
		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyRenvFilesArePresent(app);
		await app.positron.console.waitForConsoleContents('renv activated');
	});

	test('R - Renv already installed', { tag: [tags.WIN] }, async function ({ app }) {
		// Renv will already be installed from the previous test - which is why tests are marked as "serial"
		const folderName = addRandomNumSuffix('r-renvAlreadyInstalled');
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			rEnvCheckbox: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyRenvFilesArePresent(app);
		await app.positron.console.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install', { tag: [tags.WIN] }, async function ({ app, packages }) {
		const folderName = addRandomNumSuffix('r-cancelRenvInstall');

		await packages.manage('renv', 'uninstall');
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			rEnvCheckbox: true,
		});

		await handleRenvInstallModal(app, 'cancel');
		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
	});
});
