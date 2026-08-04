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
	await app.workbench.layouts.enterLayout('stacked');
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

	test('R - Renv already installed', { tag: [tags.WIN] }, async function ({ app, packages }) {

		await packages.manage('renv', 'install');

		const folderName = addRandomNumSuffix('r-renvAlreadyInstalled');
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			rEnvCheckbox: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install', { tag: [tags.WIN] }, async function ({ app, packages }) {
		// Uninstalling renv, reloading into the new folder, starting an R session and then waiting
		// out the renv modal adds up to more than the default 2 minute budget on Windows CI.
		test.slow();

		const folderName = addRandomNumSuffix('r-cancelRenvInstall');

		await packages.manage('renv', 'uninstall');
		await app.workbench.console.waitForReady('>', 30000);
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			rEnvCheckbox: true,
		});

		// Wait for the new folder to finish loading before waiting on the modal. `createNewFolder`
		// returns as soon as the wizard closes, and the reload can take 25-40s on Windows CI --
		// waiting on the modal first spends its timeout on the reload instead of on the modal.
		await verifyFolderCreation(app, folderName);
		await handleRenvInstallModal(app, 'cancel');
		await verifyConsoleReady(app, folderTemplate);
	});
});
