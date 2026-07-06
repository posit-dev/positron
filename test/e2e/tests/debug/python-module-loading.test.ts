/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';


test.use({
	suiteId: __filename
});

test.describe('Python Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN, tags.CONSOLE]
}, () => {

	test.beforeEach(async function ({ settings }) {
		// Disable the missing-packages preflight so the Run gesture doesn't open a
		// blocking install modal (app.py's local `helper` import is flagged as a
		// missing package once its cache warms). This test is about module auto
		// reload, not package installation.
		await settings.set({ 'packages.confirmMissingOnRun': false }, { keepOpen: false });
	});

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('Python - Verify Module Auto Reload', async function ({ app, python, openFile, hotKeys }) {

		await test.step('Open file, run, validate ouput', async () => {

			await openFile(join('workspaces', 'python_module_caching', 'app.py'));

			await app.workbench.editor.pressPlay(true);

			await app.workbench.console.waitForConsoleContents('Hello World');

		});

		const helperFile = 'helper_functions.py';

		await test.step('Edit helper', async () => {

			await openFile(join('workspaces', 'python_module_caching', 'helper', helperFile));

			await app.workbench.editor.replaceTerm(helperFile, '"Hello', 2, 'Goodbye');

			await hotKeys.save();
		});

		await test.step('Re-run with edited helper', async () => {
			await openFile(join('workspaces', 'python_module_caching', 'app.py'));

			await app.workbench.editor.pressPlay(true);

			await app.workbench.console.waitForConsoleContents('Goodbye World');
		});

	});
});
