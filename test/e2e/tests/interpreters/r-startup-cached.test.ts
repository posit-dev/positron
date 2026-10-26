/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
R must not start on its own in a folder with no R files, even when the interpreter
cache was last filled in a folder that had them (#16376).

The cache is shared by every folder. When it's up to date, R's search doesn't run,
and Positron loads R from the cache. R's recommendation decides whether R starts
right away, checked fresh in each folder. This test runs the real R extension with
the real cache across three folders, which unit tests can't.

Each folder is opened in a new launch with `app.restart()`, and the cache carries
over because the launches share the same user data. Python is set to `manual` so
only R can start on its own.
*/

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, tags } from '../_test.setup';
import { Application } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('R Startup With a Cached Interpreter', {
	tag: [tags.INTERPRETER, tags.ARK]
}, () => {
	let originalWorkspace: string;
	let root: string;

	test.beforeAll(async function ({ app, settings }) {
		originalWorkspace = app.workspacePathOrFolder;
		// Outside the default workspace, so its R files can't affect other launches.
		root = path.join(path.dirname(originalWorkspace), `r-startup-cached-${Date.now()}`);
		await settings.set({
			'interpreters.startupBehavior': 'auto',
			'[python]': { 'interpreters.startupBehavior': 'manual' },
		});
	});

	test.afterAll(async function ({ app }) {
		await app.restart({ workspaceOrFolder: originalWorkspace });
		await app.workbench.userSettings.set({ 'interpreters.startupBehavior': 'manual' });
		await app.workbench.userSettings.remove(['[python]']);
		await fs.promises.rm(root, { recursive: true, force: true });
	});

	/** Creates a folder with the given files under the test's root. */
	async function makeFolder(name: string, files: Record<string, string>): Promise<string> {
		const folder = path.join(root, name);
		await fs.promises.mkdir(folder, { recursive: true });
		for (const [file, content] of Object.entries(files)) {
			await fs.promises.writeFile(path.join(folder, file), content);
		}
		return folder;
	}

	/** Launches Positron on a folder and waits for the window. */
	async function launchIn(app: Application, folder: string): Promise<void> {
		await test.step(`Launch in ${path.basename(folder)}`, async () => {
			await app.restart({ workspaceOrFolder: folder });
		});
	}

	async function expectRToStart(app: Application): Promise<void> {
		const { sessions } = app.workbench;
		await sessions.expectSessionCountToBe(1);
		const { name } = await sessions.getMetadata();
		expect(name).toMatch(/^R \d/);
	}

	test('R starts only in folders with R files', async function ({ app }) {
		test.slow();
		const rProject = await makeFolder('r-project', { 'analysis.R': 'x <- 1\n' });
		const newFolder = await makeFolder('new-folder', { 'README.md': '# Notes\n' });
		const rProject2 = await makeFolder('r-project-2', { 'model.R': 'y <- 2\n' });

		await test.step('Fill the cache while a folder with R files is open', async () => {
			await launchIn(app, rProject);
			// Let this launch's own search finish first, so it can't refill the cache after it's cleared.
			await app.workbench.sessions.expectDiscoveryToComplete();
			await app.workbench.quickaccess.runCommand('workbench.action.language.runtime.clearInterpreterCache');
			await launchIn(app, rProject);
			await expectRToStart(app);
			// R starts from the affiliated runtime before the search runs, so wait
			// for the search to fill the cache before leaving this folder.
			await app.workbench.sessions.expectDiscoveryToComplete();
		});

		await test.step('A new folder with no R files: R does not start', async () => {
			await launchIn(app, newFolder);
			const { console, sessions } = app.workbench;
			await sessions.expectDiscoveryToComplete();

			// R is listed, so it was loaded from the cache and could have started.
			const runtimes = await sessions.getAllAvailableRuntimes();
			expect(runtimes.some(runtime => /^R \d/.test(runtime.name))).toBe(true);

			await sessions.expectSessionCountToBe(0);
			await expect(console.emptyConsole).toBeVisible();
		});

		await test.step('A new folder with R files: R starts while the cache is up to date', async () => {
			await launchIn(app, rProject2);
			await expectRToStart(app);
		});
	});
});
