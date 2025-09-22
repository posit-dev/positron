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
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test.afterAll(async function ({ cleanup }) {

		await cleanup.discardAllChanges();

	});

	test('Python - Verify Module Auto Reload', async function ({ app, python, openFile, hotKeys }) {

		await test.step('Open file, run, validate ouput', async () => {

			await openFile(join('workspaces', 'python_module_caching', 'app.py'));

			await app.positron.editor.pressPlay(true);

			await app.positron.console.waitForConsoleContents('Hello World');

		});

		const helperFile = 'helper_functions.py';

		await test.step('Edit helper', async () => {

			await openFile(join('workspaces', 'python_module_caching', 'helper', helperFile));

			await app.positron.editor.replaceTerm(helperFile, '"Hello', 2, 'Goodbye');

			await hotKeys.save();
		});

		await test.step('Re-run with edited helper', async () => {
			await openFile(join('workspaces', 'python_module_caching', 'app.py'));

			await app.positron.editor.pressPlay(true);

			await app.positron.console.waitForConsoleContents('Goodbye World');
		});

	});
});
