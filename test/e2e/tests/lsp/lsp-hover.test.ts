/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Hover', {
	tag: [tags.WEB, tags.WIN, tags.EDITOR]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
	});

	test('Python - Verify pd.DataFrame hover shows preview', async function ({ app, page, python }) {
		await app.workbench.quickaccess.openFile(join(
			app.workspacePathOrFolder,
			'workspaces', 'generate-data-frames-py', 'simple-data-frames.py',
		));

		// Double-click "df" to select it and position the cursor.
		await page.locator('span').filter({ hasText: 'print(df)' }).locator('span').filter({ hasText: 'df' }).dblclick();

		// The first time we should get the Pyrefly hover.
		const hoverContent = page.locator('.monaco-hover:not(.hidden) .monaco-hover-content');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('editor.action.hideHover');
			await app.workbench.quickaccess.runCommand('editor.action.showHover');

			await expect(hoverContent).toBeVisible();
			await expect(hoverContent).toContainText('(variable) df');
		}).toPass({ timeout: 60000 });

		// Run the file.
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		// Hover again, and this time we should get the rich hover with the dataframe preview.
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('editor.action.hideHover');
			await app.workbench.quickaccess.runCommand('editor.action.showHover');

			await expect(hoverContent).toBeVisible();
			await expect(hoverContent).toContainText('Training', { timeout: 1000 });  // a column name
		}).toPass({ timeout: 60000 });
	});
});
