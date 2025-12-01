/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Simple Test: Files Pane Refresh
// Description: Verify that the Files pane refreshes after creating a file via the console.

import { test, tags, expect } from '../_test.setup';
import { createFileViaConsole } from '../new-folder-flow/helpers/new-folder-flow';

test.use({
	suiteId: __filename
});

test.describe('Files Pane Refresh', { tag: [tags.WEB, tags.WORKBENCH, tags.CONSOLE] }, () => {

	test.afterAll(async ({ cleanup, app }) => {
		// Primary removal via filesystem
		await cleanup.removeTestFiles(['file.txt']);

		// Verify removal in Files pane; if still present, remove via console as a fallback
		const filesList = app.code.driver.page.locator('.monaco-list > .monaco-scrollable-element');
		const stillVisible = await filesList.getByText('file.txt').count();
		if (stillVisible > 0) {
			await app.workbench.console.executeCode('Python', `import pathlib
p = pathlib.Path('file.txt')
try:
    p.unlink()
except FileNotFoundError:
    pass`);
			await expect(filesList.getByText('file.txt')).toHaveCount(0, { timeout: 10000 });
		}
	});

	test('Files pane refreshes after creating file.txt via console', async function ({ app, python }) {
		await createFileViaConsole(app, 'Python', 'file.txt');
	});
	// only Python needed since the  file creation principle is the same with the R console
});
