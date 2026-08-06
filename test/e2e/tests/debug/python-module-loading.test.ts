/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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

	test.afterAll(async function ({ cleanup }) {

		// Edited by 'Edit helper' to prove the module reloads.
		await cleanup.restoreFiles([join('workspaces', 'python_module_caching', 'helper', 'helper_functions.py')]);
		// Byproduct of importing the helper module; untracked and not gitignored.
		await cleanup.removeTestFolder(join('workspaces', 'python_module_caching', 'helper', '__pycache__'));

	});

	test('Python - Verify Module Auto Reload', async function ({ app, python, openFile, hotKeys }) {

		await test.step('Open file, run, validate ouput', async () => {

			await openFile(join('workspaces', 'python_module_caching', 'app.py'));

			await app.workbench.editor.pressPlay({ skipToastVerification: true });

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

			await app.workbench.editor.pressPlay({ skipToastVerification: true });

			await app.workbench.console.waitForConsoleContents('Goodbye World');
		});

	});
});
