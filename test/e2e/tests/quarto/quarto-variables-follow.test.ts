/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Variables Follow Mode', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO, tags.VARIABLES]
}, () => {

	test.beforeAll(async function ({ app, python, settings }) {
		// Start Python first to ensure a runtime is available
		// Enable the Quarto inline output feature
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true,
			'positron.variables.followMode': true
		}, { reload: true });
	});

	test.afterAll(async function ({ settings }) {
		// Disable the feature after tests
		await settings.set({
			'positron.quarto.inlineOutput.enabled': false
		});
	});

	test('Python - Variables pane follows active QMD editor', async function ({ app, openFile }) {
		const page = app.code.driver.page;
		const { variables, console: positronConsole, hotKeys } = app.workbench;

		// Step 1: Execute code in the console to create a console session with a variable
		// This establishes the console as the initial foreground session
		await positronConsole.executeCode('Python', 'console_var = 123');

		// Show the secondary sidebar to see variables
		await hotKeys.fullSizeSecondarySidebar();

		// Verify the console session is showing in variables pane
		// The session name should be "Python" (the console session)
		await variables.expectSessionToBe(/Python/);
		await variables.expectVariableToBe('console_var', '123');

		// Step 2: Open a Quarto document with Python code
		await openFile(join('workspaces', 'quarto_python', 'report.qmd'));

		// Wait for the editor to be ready
		const editor = page.locator('.monaco-editor').first();
		await expect(editor).toBeVisible({ timeout: 10000 });

		// Wait for the Quarto inline output feature to recognize this as a Quarto document
		const statusBarIndicator = page.locator('.statusbar-item').filter({ hasText: /Quarto/ });
		await expect(statusBarIndicator.first()).toBeVisible({ timeout: 30000 });

		// Click on the editor to ensure focus
		await editor.click();
		await page.waitForTimeout(500);

		// Position cursor in the Python code cell (line 17)
		await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
		await page.keyboard.type('17');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);

		// Step 3: Run the current cell to start the Quarto kernel and create variables
		await app.workbench.quickaccess.runCommand('positronQuarto.runCurrentCell');

		// Wait for kernel to start and execution to complete
		// The inline output appearing confirms execution completed
		const inlineOutput = page.locator('.quarto-inline-output');
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('workbench.action.gotoLine', { keepOpen: true });
			await page.keyboard.type('30');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(500);
			await expect(inlineOutput).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 120000 });

		// After running code in the QMD, variables pane should show the QMD's session
		// The session name should contain "report.qmd" since that's the Quarto document
		await variables.expectSessionToBe(/report\.qmd/);

		// Step 4: Open a Python file to create a second editor tab
		// This is needed because onDidActiveEditorChange only fires when switching between
		// editor tabs, not when focusing the console panel
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await page.waitForTimeout(500);

		// Execute more code in the console - this will make it the foreground session
		// and the follow mode should switch variables to the console
		await positronConsole.focus();
		await positronConsole.typeToConsole('another_var = 456', true);
		await positronConsole.waitForReady('>>>');

		// Verify the variables pane switched to the console session (NOT the QMD)
		await variables.expectSessionToBe(/Python/);
		await variables.expectVariableToBe('another_var', '456');

		// Step 5: Now switch back to the QMD editor tab
		// Click on the editor tab for report.qmd - this triggers onDidActiveEditorChange
		const qmdTab = page.locator('.tab').filter({ hasText: 'report.qmd' });
		await qmdTab.click();
		await page.waitForTimeout(500);

		// Step 6: With follow mode enabled, the variables pane should switch to the QMD's session
		// This is the key assertion - verifying the feature works
		await variables.expectSessionToBe(/report\.qmd/);
	});
});
