/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
What starts when `interpreters.startupBehavior` is `always`: an interpreter starts in every
new window, even in a folder with no language files and no saved interpreter. The
interpreter used last still wins when there is one.

Each folder sets `always` in its own `.vscode/settings.json`, for all languages or for
Python only, and is opened in a new launch.
*/

import { test, tags } from '../_test.setup';
import { expectSingleSession, PYTHON_NAME, StartupFolders } from './helpers/startup-folders.js';

test.use({
	suiteId: __filename
});

test.describe('Interpreter Startup - Always', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.ARK]
}, () => {
	let folders: StartupFolders;

	test.beforeAll(async function ({ app }) {
		folders = new StartupFolders(app, 'startup-always');
	});

	test.afterAll(async function () {
		await folders.remove();
	});

	test('An interpreter starts in a folder with no language files', async function ({ app }) {
		await folders.launch(await folders.folder('always-all', {
			files: { 'README.md': '# Notes\n' },
			settings: { 'interpreters.startupBehavior': 'always' },
		}));

		// The setting says an interpreter always starts; which language is not promised.
		await expectSingleSession(app, { name: /^(Python|R) \d/, startReasonId: 'startupBehaviorAlwaysAllLanguages' });
	});

	test('Python starts in a folder with no language files, even after its console was closed', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('always-python', {
			files: { 'README.md': '# Notes\n' },
			settings: { '[python]': { 'interpreters.startupBehavior': 'always' } },
		}));
		await expectSingleSession(app, { name: PYTHON_NAME, startReasonId: 'startupBehaviorAlways' });

		// Closing the console forgets it; `always` starts Python anyway, where `auto` would not.
		await test.step('Close the console and open the folder again', async () => {
			const { sessions } = app.workbench;
			await sessions.delete(await sessions.getCurrentSessionId());
			await folders.launch(app.workspacePathOrFolder);
		});
		await expectSingleSession(app, { name: PYTHON_NAME, startReasonId: 'startupBehaviorAlways' });
	});

	test('The interpreter used last starts instead of the default pick', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('always-used-last', {
			files: { 'README.md': '# Notes\n' },
			settings: { 'interpreters.startupBehavior': 'always' },
		}));
		const { sessions } = app.workbench;
		await sessions.expectSessionCountToBe(1);
		// Close the default pick so the alternate R is the only interpreter this folder remembers.
		await sessions.delete(await sessions.getCurrentSessionId());
		const used = await sessions.start('rAlt');

		await folders.launch(app.workspacePathOrFolder);
		await expectSingleSession(app, { name: used.name, startReasonId: 'affiliatedRuntime' });
	});
});
