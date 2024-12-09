/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('F1 Help #web #win', {
	tag: ['@web', '@win', '@help']
}, () => {

	test('R - Verifies basic F1 help functionality [C1018854]', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await app.workbench.quickaccess.runCommand('r.sourceCurrentFile');

		await app.workbench.positronConsole.pasteCodeToConsole('colnames(df2)');
		await app.workbench.positronConsole.doubleClickConsoleText('colnames');
		await app.workbench.positronConsole.sendKeyboardKey('F1');

		await expect(async () => {
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('body')).toContainText('Row and Column Names', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});


	test('Python - Verifies basic F1 help functionality [C1018854]', async function ({ app, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await app.workbench.quickaccess.runCommand('python.execInConsole');

		await app.workbench.positronConsole.pasteCodeToConsole('list(df.columns)');
		await app.workbench.positronConsole.doubleClickConsoleText('list');
		await app.workbench.positronConsole.sendKeyboardKey('F1');

		await expect(async () => {
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('p').first()).toContainText('Built-in mutable sequence.', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});
});
