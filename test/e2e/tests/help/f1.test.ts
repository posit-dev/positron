/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename,
});

test.describe('F1 Help', {
	tag: [tags.WEB, tags.WIN, tags.HELP]
}, () => {

	// Teardown only; each test sets its own layout precondition at the start.
	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await hotKeys.closeSecondarySidebar();
		// Notebook layout can hide the console panel; only clear when visible.
		if (await app.workbench.console.clearButton.isVisible()) {
			await app.workbench.console.clearButton.click();
		}
	});

	test('R - Verify basic F1 console help functionality', async function ({ app, page, r, openFile, runCommand }) {
		const { variables, console, layouts } = app.workbench;

		await layouts.enterLayout('stacked');
		await openFile(join('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
		await runCommand('r.sourceCurrentFile');

		await variables.clickSessionLink();
		await variables.waitForVariableRow('df2');

		await console.pasteCodeToConsole('colnames(df2)');
		await console.doubleClickConsoleText('colnames');

		await page.keyboard.press('F1');
		const helpFrame = await app.workbench.help.getHelpFrame();
		await expect(helpFrame.locator('body')).toContainText('Row and Column Names', { timeout: 30000 });
	});

	test('R - Verify basic F1 editor help functionality', async function ({ app, page, r, openFile }) {
		await app.workbench.layouts.enterLayout('stacked');
		await openFile(join('workspaces', 'generate-data-frames-r', 'generate-data-frames.r'));
		await page.locator('span').filter({ hasText: 'colnames(df) <- paste0(\'col\', 1:num_cols)' }).locator('span').first().dblclick();

		await page.keyboard.press('F1');
		const helpFrame = await app.workbench.help.getHelpFrame();
		await expect(helpFrame.locator('h2').first()).toContainText('Row and Column Names', { timeout: 30000 });
	});

	test('Python - Verify basic F1 console help functionality', async function ({ app, page, python, openFile, runCommand }) {
		const { variables, console, layouts } = app.workbench;

		await layouts.enterLayout('stacked');
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await runCommand('python.execInConsole');

		await variables.clickSessionLink();
		await variables.waitForVariableRow('df');

		await console.pasteCodeToConsole('list(df.columns)');
		await console.doubleClickConsoleText('list');

		await page.keyboard.press('F1');
		const helpFrame = await app.workbench.help.getHelpFrame();
		await expect(helpFrame.locator('p').first()).toContainText('Built-in mutable sequence.', { timeout: 30000 });
	});

	test('Python - Verify basic F1 editor help functionality', async function ({ app, page, python }) {
		const fileName = 'generate-data-frames.py';
		await app.workbench.layouts.enterLayout('stacked');
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'generate-data-frames-py', fileName));

		// Wait for editor content to be fully rendered before interacting
		await app.workbench.editor.waitForEditorContents(fileName, (content) => content.includes('pd.DataFrame'));
		await app.code.driver.currentPage.locator('span').filter({ hasText: 'df = pd.DataFrame(data)' }).locator('span').first().dblclick();

		await page.keyboard.press('F1');
		const helpFrame = await app.workbench.help.getHelpFrame();
		await expect(helpFrame.locator('h1').first()).toContainText('pandas.DataFrame', { timeout: 30000 });
	});

	// Notebook tests run last: the notebook->stacked transition leaves the Help
	// webview unresolvable for a following console/editor test.
	test('R - Verify basic F1 notebook help functionality', { tag: tags.POSITRON_NOTEBOOKS }, async function ({ app, page, r, openDataFile }) {
		const { layouts } = app.workbench;

		await openDataFile(join('workspaces', 'large_r_notebook', 'spotify.ipynb'));
		await layouts.enterLayout('notebook');

		await page.locator('span').filter({ hasText: 'options(digits = 2)' }).locator('span').first().dblclick();

		// F1 in a notebook cell may not register until the editor has token focus; retry.
		await expect(async () => {
			await page.keyboard.press('F1');
			const helpFrame = await app.workbench.help.getHelpFrame();
			await expect(helpFrame.locator('h2').first()).toContainText('Options Settings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });
	});

	test('Python - Verify basic F1 notebook help functionality', { tag: tags.POSITRON_NOTEBOOKS }, async function ({ app, page, python, openDataFile }) {
		const { notebooksPositron, layouts } = app.workbench;

		await openDataFile(join('workspaces', 'large_py_notebook', 'spotify.ipynb'));
		await layouts.enterLayout('notebook');

		// Position the mouse over the notebook for scrolling
		await notebooksPositron.cell.first().hover();
		const target = page.locator('span').filter({ hasText: 'warnings.filterwarnings(\'ignore\')' }).locator('span').first();

		// Scroll the notebook until the target line is rendered in the DOM.
		// The cell may be taller than the viewport, so Monaco only renders visible lines.
		// mouse.wheel delta values > 1 are not processed correctly, so a loop is needed.
		await expect(async () => {
			if (await target.count() === 0) {
				for (let i = 0; i < 5; i++) {
					await page.mouse.wheel(0, 1);
				}
				throw new Error('Target not yet in DOM, continuing to scroll');
			}
		}).toPass({ timeout: 30000 });

		await target.dblclick();

		// F1 in a notebook cell may not register until the editor has token focus; retry.
		await expect(async () => {
			await page.keyboard.press('F1');
			const helpFrame = await app.workbench.help.getHelpFrame();
			await expect(helpFrame.locator('body').first()).toContainText('warnings.filterwarnings', { timeout: 2000 });
		}).toPass({ timeout: 30000 });
	});

});
