/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra/index.js';
import { test, tags } from '../_test.setup';
import { expect, Locator } from '@playwright/test';

test.use({
	suiteId: __filename
});

/**
 * Helper function to execute code in a cell and wait for the execution info icon to appear
 */
async function executeCodeAndWaitForIcon(app: Application, code: string, cellIndex: number = 0) {
	const cell = await app.workbench.notebooksPositron.addCodeToCellAndRun(code, cellIndex);
	const icon = cell.getByLabel('Cell execution info');
	return icon;
}

async function activateInfoPopup({ app, icon }: { app: Application; icon: Locator }): Promise<Locator> {
	await icon.hover({ force: true });
	const popup = app.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' });
	await expect(popup).toBeVisible();
	return popup;
}

test.describe('Cell Execution Info Popup', {
	tag: [tags.CRITICAL, tags.WEB, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.workbench.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test('Comprehensive cell execution info test - all scenarios in one notebook', async function ({ app }) {
		// Setup: Create notebook and select kernel once
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooksPositron.selectAndWaitForKernel('Python');

		// ========================================
		// Cell 0: Basic popup display with successful execution
		// ========================================
		const icon0 = await executeCodeAndWaitForIcon(app, 'print("hello world")', 0);
		const popup0 = await activateInfoPopup({ app, icon: icon0 });

		// Verify popup content shows execution info
		await expect(popup0.getByLabel('Execution order')).toBeVisible();
		await expect(popup0.getByLabel('Execution order')).toContainText('1');
		await expect(popup0.getByLabel('Execution duration')).toBeVisible();
		await expect(popup0.getByLabel('Execution status')).toContainText('Success');

		// Verify auto-close behavior
		await app.code.driver.page.mouse.move(0, 0); // Move mouse away
		await expect(popup0).toBeHidden();

		// ========================================
		// Cell 1: Failed execution state display
		// ========================================
		// Create and execute a new cell with failing code
		const icon1 = await executeCodeAndWaitForIcon(app, 'raise Exception("test error")', 1);
		await expect(icon1).toBeVisible();

		// Verify failed execution status
		await expect(icon1).toHaveAttribute('data-execution-status', 'failed');

		// Verify popup shows failed status
		const popup1 = await activateInfoPopup({ app, icon: icon1 });
		await expect(popup1).toContainText(/Failed/i);

		// Move mouse away to close popup
		await app.code.driver.page.mouse.move(0, 0);
		await expect(popup1).toBeHidden();

		// ========================================
		// Cell 2: Running execution state display
		// ========================================
		// Add a code cell that will run for a reasonable time
		await app.workbench.notebooksPositron.addCodeToCellAtIndex('import time; time.sleep(3)', 2);

		// Start executing the cell without waiting for completion
		await app.workbench.notebooksPositron.startExecutingCodeInCell(2);

		// Wait for execution to start - spinner should appear in button area
		const cell2 = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(2);
		const spinner = cell2.getByLabel('Cell is executing');
		await expect(spinner).toBeVisible({ timeout: 5000 });

		// Wait for execution info icon to appear during execution and verify running state
		const icon2 = app.workbench.notebooksPositron.getExecutionInfoIcon(2);
		await expect(icon2).toBeVisible({ timeout: 3000 });
		await expect(icon2).toHaveAttribute('data-execution-status', 'running');

		// Verify spinning icon is present in the execution info icon
		const popup2 = await activateInfoPopup({ app, icon: icon2 });

		// Verify popup shows running status
		await expect(popup2).toContainText('Currently running...');

		// Move mouse away and wait for execution to complete
		await app.code.driver.page.mouse.move(0, 0);
		await expect(spinner).toHaveCount(0, { timeout: 10000 });

		// ========================================
		// Cell 3: Relative time display
		// ========================================
		// Execute code in a new cell and get the execution info icon
		const icon3 = await executeCodeAndWaitForIcon(app, 'print("relative time test")', 3);
		const popup3 = await activateInfoPopup({ app, icon: icon3 });

		// Verify relative time is displayed (should show recent execution)
		// Some renderers may insert non-breaking spaces between words. Use \s to match any whitespace.
		// Some renderers may insert non-breaking spaces between words. Check for either phrase.
		const popupText = await popup3.textContent();
		expect(
			popupText?.toLowerCase().includes('seconds ago') ||
			popupText?.toLowerCase().includes('just now')
		).toBeTruthy();

		// Move mouse away to close popup
		await app.code.driver.page.mouse.move(0, 0);
		await expect(popup3).toBeHidden();

		// ========================================
		// Cell 4: Hover timing and interaction
		// ========================================
		// Execute code in a new cell and get the execution info icon
		const icon4 = await executeCodeAndWaitForIcon(app, 'print("hover test")', 4);
		const popup4 = await activateInfoPopup({ app, icon: icon4 });

		// Test popup closes when mouse moves away
		await app.code.driver.page.mouse.move(0, 0);
		await expect(popup4).toBeHidden();

		// Test that hovering again after closing still works
		await icon4.hover();
		await expect(popup4).toBeVisible();

		// ========================================
		// Cleanup
		// ========================================
		// Move mouse away to ensure tooltip is hidden before closing
		await app.code.driver.page.mouse.move(0, 0);
		await expect(app.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' })).toBeHidden();

		// Close the notebook without saving
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});
});
