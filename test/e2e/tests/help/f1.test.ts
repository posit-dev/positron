/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});


test.describe('F1 Help', {
	tag: [tags.WEB, tags.WIN, tags.HELP]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.positron.quickaccess.runCommand('workbench.action.closeAllEditors');
		await app.positron.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
		await app.positron.console.clearButton.click();
		await app.positron.quickaccess.runCommand('workbench.action.toggleAuxiliaryBar');
	});

	test('R - Verify basic F1 console help functionality', async function ({ app, page, r }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await app.positron.quickaccess.runCommand('r.sourceCurrentFile');

		await app.positron.variables.clickSessionLink();
		await app.positron.variables.waitForVariableRow('df2');

		await app.positron.console.pasteCodeToConsole('colnames(df2)');
		await app.positron.console.doubleClickConsoleText('colnames');
		await page.keyboard.press('F1');

		await expect(async () => {
			const helpFrame = await app.positron.help.getHelpFrame(0);
			await expect(helpFrame.locator('body')).toContainText('Row and Column Names', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('R - Verify basic F1 editor help functionality', async function ({ app, page, r }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-r', 'generate-data-frames.r'));

		await app.code.driver.page.locator('span').filter({ hasText: 'colnames(df) <- paste0(\'col\', 1:num_cols)' }).locator('span').first().dblclick();
		await page.keyboard.press('F1');

		await expect(async () => {
			const helpFrame = await app.positron.help.getHelpFrame(0);
			await expect(helpFrame.locator('h2').first()).toContainText('Row and Column Names', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('R - Verify basic F1 notebook help functionality', async function ({ app, page, r }) {
		await app.positron.quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_r_notebook', 'spotify.ipynb'));

		await app.positron.layouts.enterLayout('notebook');

		// workaround
		await app.positron.notebooks.selectInterpreter('R', process.env.POSITRON_R_VER_SEL!);

		await app.code.driver.page.locator('span').filter({ hasText: 'options(digits = 2)' }).locator('span').first().dblclick();

		await expect(async () => {
			await page.keyboard.press('F1');

			// Note that we are getting help frame 1 instead of 0 because the notebook structure matches the same locators as help
			const helpFrame = await app.positron.help.getHelpFrame(1);

			await expect(helpFrame.locator('h2').first()).toContainText('Options Settings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });

		await app.positron.layouts.enterLayout('stacked');

	});

	test('Python - Verify basic F1 console help functionality', async function ({ app, page, python }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await app.positron.quickaccess.runCommand('python.execInConsole');

		await app.positron.variables.clickSessionLink();
		await app.positron.variables.waitForVariableRow('df');

		await app.positron.console.pasteCodeToConsole('list(df.columns)');
		await app.positron.console.doubleClickConsoleText('list');
		await page.keyboard.press('F1');

		await expect(async () => {
			const helpFrame = await app.positron.help.getHelpFrame(0);
			await expect(helpFrame.locator('p').first()).toContainText('Built-in mutable sequence.', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('Python - Verify basic F1 editor help functionality', async function ({ app, page, python }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-py', 'generate-data-frames.py'));

		await app.code.driver.page.locator('span').filter({ hasText: 'df = pd.DataFrame(data)' }).locator('span').first().dblclick();

		await page.keyboard.press('F1');

		await expect(async () => {
			const helpFrame = await app.positron.help.getHelpFrame(0);
			await expect(helpFrame.locator('h1').first()).toContainText('pandas.DataFrame', { timeout: 30000 });
		}).toPass({ timeout: 30000 });

	});

	test('Python - Verify basic F1 notebook help functionality', async function ({ app, page, python }) {
		await app.positron.quickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'large_py_notebook', 'spotify.ipynb'));

		await app.code.driver.page.locator('span').filter({ hasText: 'warnings.filterwarnings(\'ignore\')' }).locator('span').first().dblclick();

		await expect(async () => {

			await page.keyboard.press('F1');

			// Note that we are getting help frame 1 instead of 0 because the notbook structure matches the same locators as help
			const helpFrame = await app.positron.help.getHelpFrame(1);

			await expect(helpFrame.locator('body').first()).toContainText('warnings.filterwarnings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });

	});

});
