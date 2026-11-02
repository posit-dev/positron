/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
A pinned interpreter starts in place of the interpreter the folder used last (#2659).

`python.defaultInterpreterPath` pins a Python and `positron.r.interpreters.default` pins an
R. Each test pins in the folder's own `.vscode/settings.json` and opens the folder in a new
launch. The folder's affiliated runtime is the interpreter whose console was in front last;
on the next open, the pin starts instead of it.
*/

import { test, expect, tags } from '../_test.setup';
import { SessionMetaData } from '../../pages/sessions.js';
import { expectSingleSession, R_NAME, StartupFolders, writeFolderSettings } from './helpers/startup-folders.js';

test.use({
	suiteId: __filename
});

// The e2e user settings say `manual`, so each folder restores the default here.
const AUTO = { 'interpreters.startupBehavior': 'auto' };

test.describe('Interpreter Startup - Pinned', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.ARK]
}, () => {
	let folders: StartupFolders;
	let altPython: SessionMetaData;

	test.beforeAll(async function ({ app }) {
		folders = new StartupFolders(app, 'startup-pinned');
		// The alternate Python's path, for pins written before a folder is first opened.
		altPython = await app.workbench.sessions.start('pythonAlt');
		await app.workbench.sessions.deleteAll();
	});

	test.afterAll(async function () {
		await folders.remove();
	});

	test('Python - the pinned Python starts in place of the one used last, and a new pin waits for the next launch', async function ({ app }) {
		test.slow();
		const folder = await folders.folder('python-pin', { files: { 'README.md': '# Notes\n' }, settings: AUTO });
		await folders.launch(folder);
		const { sessions } = app.workbench;
		const pinned = await sessions.start('python');
		// The Python that starts last is the one the folder used last.
		await sessions.start('pythonAlt');

		await test.step('Pin the first Python and open the folder again', async () => {
			await writeFolderSettings(folder, { ...AUTO, 'python.defaultInterpreterPath': pinned.path });
			await folders.launch(folder);
		});
		await expectSingleSession(app, { name: pinned.name, startReasonId: 'pinnedRuntime' });
		const { id: runningId } = await app.workbench.sessions.getMetadata();

		await test.step('Change the pin and reload the window', async () => {
			await writeFolderSettings(folder, { ...AUTO, 'python.defaultInterpreterPath': altPython.path });
			await app.workbench.hotKeys.reloadWindow(true);
		});
		// A reload reconnects the running console; the new pin does not start anything.
		await app.workbench.sessions.expectSessionCountToBe(1);
		expect((await app.workbench.sessions.getMetadata()).id).toBe(runningId);

		await test.step('Open the folder again', async () => {
			await folders.launch(folder);
		});
		await expectSingleSession(app, { name: altPython.name, startReasonId: 'pinnedRuntime' });
	});

	test('R - the pinned R starts in place of the one used last', async function ({ app }) {
		test.slow();
		const folder = await folders.folder('r-pin', { files: { 'analysis.R': 'x <- 1\n' }, settings: AUTO });
		await folders.launch(folder);
		const { sessions } = app.workbench;
		await expectSingleSession(app, { name: R_NAME });
		const pinned = await sessions.start('rAlt');
		// The R that is in front last is the one the folder used last.
		await sessions.start('r');

		await test.step('Pin the alternate R and open the folder again', async () => {
			await writeFolderSettings(folder, { ...AUTO, 'positron.r.interpreters.default': pinned.path });
			await folders.launch(folder);
		});
		await expectSingleSession(app, { name: pinned.name, startReasonId: 'pinnedRuntime' });
	});

	test('Python - a pin in the folder settings decides the first open', async function ({ app }) {
		await folders.launch(await folders.folder('python-pin-first-open', {
			files: { 'main.py': 'x = 1\n' },
			settings: { ...AUTO, 'python.defaultInterpreterPath': altPython.path },
		}));

		await expectSingleSession(app, { name: altPython.name });
	});

	test('Python - a pin that points to a missing interpreter leaves the one used last to start', async function ({ app }) {
		test.slow();
		const folder = await folders.folder('python-bad-pin', { files: { 'README.md': '# Notes\n' }, settings: AUTO });
		await folders.launch(folder);
		const used = await app.workbench.sessions.start('python');

		await writeFolderSettings(folder, { ...AUTO, 'python.defaultInterpreterPath': '/nonexistent/bin/python' });
		await folders.launch(folder);

		await expectSingleSession(app, { name: used.name, startReasonId: 'affiliatedRuntime' });
	});
});
