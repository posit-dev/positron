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

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test('Python - Variables pane follows active QMD editor', async function ({ app, python, openFile, page }) {
		const { variables, console, hotKeys, inlineQuarto, editors } = app.workbench;

		// Step 1: Execute code in the console to create a console session with a variable
		// This establishes the console as the initial foreground session
		await console.executeCode('Python', 'console_var = 123');

		// Show the secondary sidebar to see variables
		await hotKeys.fullSizeSecondarySidebar();

		// Verify the console variable is showing in variables pane
		await variables.expectVariableToBe('console_var', '123');

		// Step 2: Open a Quarto document with Python code
		await openFile(join('workspaces', 'quarto_python', 'report.qmd'));
		await editors.waitForActiveTab('report.qmd');

		// Wait for the Quarto inline output feature to recognize this as a Quarto document
		const statusBarIndicator = page.locator('.statusbar-item').filter({ hasText: /Quarto/ });
		await expect(statusBarIndicator.first()).toBeVisible({ timeout: 30000 });

		// Step 3: Run the current cell to start the Quarto kernel and create variables
		await editors.clickTab('report.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 17, outputLine: 30 });

		// After running code in the QMD, variables pane should show the QMD's variables
		await variables.waitForVariableRow('theta');
		await variables.expectVariableToNotExist('console_var');

		// Step 4: Open a Python file to create a second editor tab
		// This is needed because onDidActiveEditorChange only fires when switching between
		// editor tabs, not when focusing the console panel
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await editors.verifyTab('flights-data-frame.py', { isVisible: true, isSelected: true });

		// Execute more code in the console - this will make it the foreground session
		// and the follow mode should switch variables to the console.
		// Use executeCode (which uses quick access) instead of typeToConsole to avoid
		// focus issues when the Settings UI or other editor panes steal keyboard input.
		await console.executeCode('Python', 'another_var = 456', { maximizeConsole: false });

		// Verify the variables pane switched to the console session (NOT the QMD)
		await variables.expectVariableToBe('another_var', '456');
		await variables.expectVariableToNotExist('theta');

		// Step 5: Now switch back to the QMD editor tab
		// Click on the editor tab for report.qmd - this triggers onDidActiveEditorChange
		await editors.clickTab('report.qmd');

		// Step 6: The variables pane should switch to the QMD's session
		// This is the key assertion - verifying the feature works
		// The console variable should not be visible, confirming the pane switched
		await variables.waitForVariableRow('theta');
		await variables.expectVariableToNotExist('another_var');
	});
});
