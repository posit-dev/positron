/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
What starts when `interpreters.startupBehavior` is `recommended`: only an interpreter the
language extension recommends for the folder. The interpreter used last is ignored.

Each folder sets `recommended` in its own `.vscode/settings.json` and is opened in a new
launch.
*/

import { test, tags } from '../_test.setup';
import { expectNoSession, expectSingleSession, R_NAME, StartupFolders } from './helpers/startup-folders.js';

test.use({
	suiteId: __filename
});

test.describe('Interpreter Startup - Recommended', {
	tag: [tags.INTERPRETER, tags.PYTHON, tags.ARK]
}, () => {
	let folders: StartupFolders;

	test.beforeAll(async function ({ app }) {
		folders = new StartupFolders(app, 'startup-recommended');
	});

	test.afterAll(async function () {
		await folders.remove();
	});

	test('R starts in a folder with R files, not the Python used last', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('r-project', {
			files: { 'analysis.R': 'x <- 1\n' },
			settings: { 'interpreters.startupBehavior': 'recommended' },
		}));
		await expectSingleSession(app, { name: R_NAME, startReasonId: 'extensionRecommendedRuntime' });

		// Python was used last, so under `auto` it would start too.
		await app.workbench.sessions.start('python');

		await folders.launch(app.workspacePathOrFolder);
		await expectSingleSession(app, { name: R_NAME, startReasonId: 'extensionRecommendedRuntime' });
		await app.workbench.sessions.expectDiscoveryToComplete();
		await app.workbench.sessions.expectSessionCountToBe(1);
	});

	test('Nothing starts in a folder with no language files, even one with a saved interpreter', async function ({ app }) {
		test.slow();
		await folders.launch(await folders.folder('no-language-files', {
			files: { 'README.md': '# Notes\n' },
			settings: { 'interpreters.startupBehavior': 'recommended' },
		}));
		await expectNoSession(app);
		await app.workbench.sessions.start('python');

		await folders.launch(app.workspacePathOrFolder);
		await expectNoSession(app);
	});
});
