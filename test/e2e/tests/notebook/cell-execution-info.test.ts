/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Helper function to execute code in a cell and wait for the execution info icon to appear
 */
async function executeCodeAndWaitForIcon(app: any, code: string, cellIndex: number = 0) {
	await app.workbench.notebooksPositron.addCodeToCellAtIndex(code);
	await app.workbench.notebooksPositron.executeCodeInCell(cellIndex);
	await app.workbench.notebooksPositron.waitForExecutionInfoIcon(cellIndex);
	return app.workbench.notebooksPositron.getExecutionInfoIcon(cellIndex);
}

test.describe('Cell Execution Info Popup', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooks.enablePositronNotebooks(settings);
	});

	test.describe('Python Notebooks - Execution Info', () => {
		test.beforeEach(async function ({ app, settings }) {
			// Configure Positron as the notebook editor
			await app.workbench.notebooks.setNotebookEditor(settings, 'positron');

			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');

			// Ensure we're using the Positron notebook editor
			await app.workbench.notebooksPositron.expectToBeVisible();
		});

		test.afterEach(async function ({ app, settings }) {
			// Make sure the mouse is away from the popup so the mouse interactions aren't swallowed by the popup
			await app.code.driver.page.mouse.move(0, 0); // Move mouse away

			await app.workbench.notebooks.closeNotebookWithoutSaving();
			// Reset to default editor
			await app.workbench.notebooks.setNotebookEditor(settings, 'default');
		});


		test('Basic popup display with successful execution and duration formatting', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("hello world")');
			await expect(icon).toBeVisible();

			// Hover over the icon
			await icon.hover();

			// Wait for popup to appear
			const popup = app.workbench.notebooksPositron.getExecutionInfoPopup();
			await expect(popup).toBeVisible();

			// Verify popup content shows execution info
			// Verify execution order shows number 1 for first execution

			await expect(popup.getByLabel('Execution order')).toBeVisible();
			await expect(popup.getByLabel('Execution order')).toContainText('1');
			await expect(popup.getByLabel('Execution duration')).toBeVisible();
			await expect(popup.getByLabel('Execution status')).toContainText('Success');

			// Verify auto-close behavior
			await app.code.driver.page.mouse.move(0, 0); // Move mouse away
			await expect(popup).toBeHidden();
		});

		test('Failed execution state display', async function ({ app }) {
			// Execute failing code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'raise Exception("test error")');
			await expect(icon).toBeVisible();

			// Verify failed execution status
			await expect(icon).toHaveAttribute('data-execution-status', 'failed');

			// Hover over the icon
			await icon.hover();

			// Wait for popup to appear
			const popup = app.workbench.notebooksPositron.getExecutionInfoPopup();
			await expect(popup).toBeVisible();

			// Verify popup shows failed status
			await expect(popup).toContainText(/Failed/i);
		});

		test('Running execution state display', async function ({ app }) {
			// Add a code cell that will run for a reasonable time
			await app.workbench.notebooksPositron.addCodeToCellAtIndex('import time; time.sleep(3)');

			// Start executing the cell without waiting for completion
			await app.workbench.notebooksPositron.startExecutingCodeInCell(0);

			// Wait for execution to start - spinner should appear in button area
			const cell = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(0);
			const spinner = cell.getByLabel('Cell is executing');
			await expect(spinner).toBeVisible({ timeout: 5000 });

			// Wait for execution info icon to appear during execution and verify running state
			const icon = app.workbench.notebooksPositron.getExecutionInfoIcon(0);
			await expect(icon).toBeVisible({ timeout: 3000 });
			await expect(icon).toHaveAttribute('data-execution-status', 'running');

			// Verify spinning icon is present in the execution info icon
			await expect(icon.getByLabel('Cell is executing')).toBeVisible();

			// Hover over the icon
			await icon.hover();

			// Wait for popup to appear
			const popup = app.workbench.notebooksPositron.getExecutionInfoPopup();
			await expect(popup).toBeVisible();

			// Verify popup shows running status
			await expect(popup).toContainText('Currently running...');
			await expect(popup.getByLabel('Cell is executing')).toBeVisible();
		});

		test('Relative time display', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("relative time test")');
			await icon.hover();
			const popup = app.workbench.notebooksPositron.getExecutionInfoPopup();
			await expect(popup).toBeVisible();

			// Verify relative time is displayed (should show recent execution)
			await expect(popup).toContainText(/seconds? ago|just now/);
		});

		test('Hover timing and interaction', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("hover test")');
			const popup = app.workbench.notebooksPositron.getExecutionInfoPopup();

			// Test hover delay - popup should not appear immediately
			await icon.hover();
			await expect(popup).toBeHidden({ timeout: 200 });

			// Wait for delay to pass and popup to appear
			await expect(popup).toBeVisible();

			// Test popup closes when mouse moves away
			await app.code.driver.page.mouse.move(0, 0);
			await expect(popup).toBeHidden();

			// Test that hovering again after closing still works
			await icon.hover();
			await expect(popup).toBeVisible();
		});
	});
});
