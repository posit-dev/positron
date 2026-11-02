/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
What starts when Positron opens a folder with the default startup behavior (`auto`).

Each test opens its own folder in a new launch, so the folder has no saved interpreter
until the test makes one. The folder's files decide which language starts on the first
open; the interpreter used last starts on later opens, until the console is closed or the
saved interpreter is cleared.
*/

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, tags } from '../_test.setup';
import { expectNoSession, expectSingleSession, PYTHON_NAME, R_NAME, StartupFolders, versionOf } from './helpers/startup-folders.js';

test.use({
	suiteId: __filename
});

// The e2e user settings say `manual`, so each folder restores the default here.
const AUTO = { 'interpreters.startupBehavior': 'auto' };

test.describe('Interpreter Startup - Auto', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.ARK]
}, () => {
	let folders: StartupFolders;

	test.beforeAll(async function ({ app }) {
		folders = new StartupFolders(app, 'startup-auto');
	});

	test.afterAll(async function () {
		await folders.remove();
	});

	test('A folder with only Python files starts Python', async function ({ app }) {
		await folders.launch(await folders.folder('python-only', { files: { 'main.py': 'x = 1\n' }, settings: AUTO }));

		await expectSingleSession(app, { name: PYTHON_NAME, startReasonId: 'extensionRecommendedRuntime' });
		// R is not recommended here, so it does not join once discovery finishes.
		await app.workbench.sessions.expectDiscoveryToComplete();
		await app.workbench.sessions.expectSessionCountToBe(1);
	});

	test('A folder with only R files starts R', async function ({ app }) {
		await folders.launch(await folders.folder('r-only', { files: { 'analysis.R': 'x <- 1\n' }, settings: AUTO }));

		await expectSingleSession(app, { name: R_NAME, startReasonId: 'extensionRecommendedRuntime' });
		await app.workbench.sessions.expectDiscoveryToComplete();
		await app.workbench.sessions.expectSessionCountToBe(1);
	});

	test('A folder with R and Python files starts both', async function ({ app }) {
		// Python joins only when the folder names its Python; otherwise R starts first and blocks it.
		const version = versionOf(process.env.POSITRON_PY_ALT_VER_SEL);
		await folders.launch(await folders.folder('r-and-python', {
			files: { 'main.py': 'x = 1\n', 'analysis.R': 'x <- 1\n', '.python-version': `${version}\n` },
			settings: AUTO,
		}));

		const { sessions } = app.workbench;
		await sessions.expectSessionCountToBe(2);
		await expect(async () => {
			const names = (await sessions.getActiveSessions()).map(session => session.name);
			expect(names.some(name => PYTHON_NAME.test(name))).toBe(true);
			expect(names.some(name => R_NAME.test(name))).toBe(true);
		}).toPass({ timeout: 90000 });
	});

	test('A folder with no language files starts nothing until a Python file is opened', async function ({ app, openFile }) {
		const folder = await folders.folder('no-language-files', { files: { 'README.md': '# Notes\n' }, settings: AUTO });
		await folders.launch(folder);
		await expectNoSession(app);

		await fs.promises.writeFile(path.join(folder, 'main.py'), 'x = 1\n');
		await openFile('main.py');

		await expectSingleSession(app, { name: PYTHON_NAME, startReasonId: 'languageFileOpened' });
	});

	test('The interpreter used last starts on the next open, until its console is closed', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('used-last', { files: { 'README.md': '# Notes\n' }, settings: AUTO }));
		const used = await app.workbench.sessions.start('pythonAlt');

		await test.step('Open the folder again', async () => {
			await folders.launch(app.workspacePathOrFolder);
		});
		await expectSingleSession(app, { name: used.name, startReasonId: 'affiliatedRuntime' });

		await test.step('Close the console and open the folder again', async () => {
			const { sessions } = app.workbench;
			await sessions.delete(await sessions.getCurrentSessionId());
			await folders.launch(app.workspacePathOrFolder);
		});
		await expectNoSession(app);
	});

	test('Clear Saved Interpreter stops the interpreter used last from starting', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('cleared', { files: { 'README.md': '# Notes\n' }, settings: AUTO }));
		await app.workbench.sessions.start('python');

		await test.step('Clear the saved Python', async () => {
			const { quickaccess, quickInput, toasts } = app.workbench;
			await quickaccess.runCommand('workbench.action.languageRuntime.clearAffiliatedRuntime', { keepOpen: true });
			await quickInput.selectQuickInputElementContaining('Python');
			await toasts.expectToastWithTitle(/Python .* interpreter has been cleared/);
		});

		await folders.launch(app.workspacePathOrFolder);
		await expectNoSession(app);
	});

	test('The interpreter used last starts after the interpreter cache is cleared', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('cache-cleared', { files: { 'README.md': '# Notes\n' }, settings: AUTO }));
		const used = await app.workbench.sessions.start('python');

		await test.step('Clear the interpreter cache', async () => {
			const { quickaccess, toasts } = app.workbench;
			await quickaccess.runCommand('workbench.action.language.runtime.clearInterpreterCache');
			await toasts.expectToastWithTitle(/Interpreter discovery cache cleared/);
		});

		await folders.launch(app.workspacePathOrFolder);
		await expectSingleSession(app, { name: used.name, startReasonId: 'affiliatedRuntime' });
	});

	test('A .python-version file picks the Python that starts', async function ({ app }) {
		const version = versionOf(process.env.POSITRON_PY_ALT_VER_SEL);
		await folders.launch(await folders.folder('python-version-file', {
			files: { 'main.py': 'x = 1\n', '.python-version': `${version}\n` },
			settings: AUTO,
		}));

		await expectSingleSession(app, { name: `Python ${version}` });
	});
});
