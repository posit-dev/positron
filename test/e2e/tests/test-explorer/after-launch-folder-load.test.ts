/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require('path');
import * as os from 'os';
import * as fs from 'fs';
import { copyFixtureFolder } from '../../infra/test-runner';
import { test as base, tags } from '../_test.setup';

// Diagnostic matrix: does Positron load a directory that is created on disk
// AFTER the app launched, and which "open folder" / "reload" mechanism does it?
//
// Every test stages the fixture only after a launch that did NOT include it
// (afterEach removes it and relaunches at the base workspace; beforeApp clears
// it before the very first launch). Each test then opens it a different way and
// checks whether the folder actually loaded as the workspace.
//
// Reading the CI report:
//   - If (1) fails but (4) passes  -> the running instance can't open an
//     after-launch dir via the dialog; a fresh relaunch can.
//   - If (2)/(3) pass              -> a reload/relaunch lets the picker see it.
//   - If (5) passes but (1) fails  -> the dialog selects it but a reload is
//     needed to actually load it.

const FIXTURE_NAME = 'r.pkg.test.explorer.fixture';
const SOURCE = path.join(process.cwd(), 'extensions/positron-r/resources/testing', FIXTURE_NAME);
const DESTINATION = path.join(os.tmpdir(), 'vscsmoke', FIXTURE_NAME);

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			// Ensure the fixture is absent at the initial launch, so the first
			// test still exercises a folder that appears strictly after launch.
			fs.rmSync(DESTINATION, { recursive: true, force: true });
			// Use the in-app Open Folder dialog, not the native picker.
			await settingsFile.append({ 'files.simpleDialog.enable': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('After-launch folder load (diagnostic)', { tag: [tags.TEST_EXPLORER, tags.WEB, tags.WIN] }, () => {

	let baseWorkspace: string;

	test.beforeAll(async function ({ app }) {
		baseWorkspace = app.workspacePathOrFolder;
	});

	test.afterEach(async function ({ app }) {
		// Reset to a clean instance that launched without the fixture, so the
		// "appears after launch" precondition holds for the next test.
		fs.rmSync(DESTINATION, { recursive: true, force: true });
		await app.restart({ workspaceOrFolder: baseWorkspace });
	});

	// Create the fixture on disk now - i.e. after the current launch.
	const stageFixtureAfterLaunch = () => copyFixtureFolder(SOURCE, DESTINATION);

	test('1. openFolder only (current behavior)', async function ({ app, openFolder }) {
		stageFixtureAfterLaunch();

		await openFolder(FIXTURE_NAME);

		await app.workbench.explorer.verifyExplorerFilesExist(['DESCRIPTION']);
	});

	test('2. reloadWindow, then openFolder', async function ({ app, openFolder }) {
		stageFixtureAfterLaunch();

		await app.workbench.hotKeys.reloadWindow(true);
		await openFolder(FIXTURE_NAME);

		await app.workbench.explorer.verifyExplorerFilesExist(['DESCRIPTION']);
	});

	test('3. restart at base workspace, then openFolder', async function ({ app, openFolder }) {
		stageFixtureAfterLaunch();

		await app.restart({ workspaceOrFolder: baseWorkspace });
		await openFolder(FIXTURE_NAME);

		await app.workbench.explorer.verifyExplorerFilesExist(['DESCRIPTION']);
	});

	test('4. restart directly at the folder (no openFolder)', async function ({ app }) {
		stageFixtureAfterLaunch();

		await app.restart({ workspaceOrFolder: DESTINATION });

		await app.workbench.explorer.verifyExplorerFilesExist(['DESCRIPTION']);
	});

	test('5. openFolder, then reloadWindow', async function ({ app, openFolder }) {
		stageFixtureAfterLaunch();

		await openFolder(FIXTURE_NAME);
		await app.workbench.hotKeys.reloadWindow(true);

		await app.workbench.explorer.verifyExplorerFilesExist(['DESCRIPTION']);
	});
});
