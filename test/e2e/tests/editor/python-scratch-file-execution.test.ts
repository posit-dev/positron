/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Python Scratch File', { tag: [tags.WEB, tags.EDITOR, tags.WIN] }, () => {
	test('Verify that lines in a python scratch file with magics can be executed', async function ({ app, python, runCommand }) {

		const filename = 'Untitled-1';
		await test.step('Create a new python scratch file with code and a magic', async () => {
			await runCommand('python.createNewFile');
			await app.positron.editor.type('print("test")\n\n%pip install pyarrow');
		});

		await test.step('Exexcute first line of code', async () => {
			await app.positron.editor.clickOnTerm(filename, 'print', 1, true);
			await app.code.driver.page.keyboard.press('ArrowLeft');
			await app.code.driver.page.keyboard.press('Control+Enter');
		});

		// ensure code execution worked
		await app.positron.console.waitForConsoleContents('test', { expectedCount: 2 });

		// Ensure "deprecated" does not appear in the console
		await app.positron.console.waitForConsoleContents('deprecated', { timeout: 5000, expectedCount: 0 });
	});
});
