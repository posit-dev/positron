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
	tag: ['@web', '@win']
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('R - Verifies basic F1 console help functionality [C1018854]', async function ({ app, r }) {
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

	test('R - Verifies basic F1 editor help functionality [C1062994]', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-r', 'generate-data-frames.r'));

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');
		await app.code.driver.page.locator('span').filter({ hasText: 'colnames(df) <- paste0(\'col\', 1:num_cols)' }).locator('span').first().dblclick();
		await app.workbench.positronConsole.sendKeyboardKey('F1');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');

		await expect(async () => {
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('h2').first()).toContainText('Row and Column Names', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('R - Verifies basic F1 notebook help functionality [C1062996]', async function ({ app, r }) {
		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_r_notebook', 'spotify.ipynb'));

		// workaround
		await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);

		await app.code.driver.page.locator('span').filter({ hasText: 'options(digits = 2)' }).locator('span').first().dblclick();

		await expect(async () => {
			await app.workbench.positronConsole.sendKeyboardKey('F1');

			// Note that we are getting help frame 1 instead of 0 because the notbook structure matches the same locators as help
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(1);

			await expect(helpFrame.locator('h2').first()).toContainText('Options Settings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });

	});

	test('Python - Verifies basic F1 console help functionality [C1062993]', async function ({ app, python }) {
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

	test('Python - Verifies basic F1 editor help functionality [C1062995]', async function ({ app, python }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-py', 'generate-data-frames.py'));

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');
		await app.code.driver.page.locator('span').filter({ hasText: 'df = pd.DataFrame(data)' }).locator('span').first().dblclick();

		await app.workbench.positronConsole.sendKeyboardKey('F1');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');

		await expect(async () => {
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(0);
			await expect(helpFrame.locator('h1').first()).toContainText('pandas.DataFrame', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('Python - Verifies basic F1 notebook help functionality [C1062997]', async function ({ app, python }) {
		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');
		await app.code.driver.page.locator('span').filter({ hasText: 'warnings.filterwarnings(\'ignore\')' }).locator('span').first().dblclick();

		// need to wait for notebook to be ready and cannot put this in retry loop as we are also
		// in the middle of a windows workaround
		await app.code.wait(10000);

		await app.workbench.positronConsole.sendKeyboardKey('F1');

		await app.workbench.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');
		await expect(async () => {

			// Note that we are getting help frame 1 instead of 0 because the notbook structure matches the same locators as help
			const helpFrame = await app.workbench.positronHelp.getHelpFrame(1);

			await expect(helpFrame.locator('body').first()).toContainText('warnings.filterwarnings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });

	});

});
