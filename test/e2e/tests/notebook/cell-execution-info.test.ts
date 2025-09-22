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
async function executeCodeAndWaitForCompletion(app: Application, code: string, cellIndex: number = 0, waitForPopup: boolean = true) {
	const cell = await app.positron.notebooksPositron.addCodeToCellAndRun(code, cellIndex);
	const infoPopup = cell.getByRole('tooltip', { name: /cell execution details/i });
	// Wait for the popup to have the execution order field indicating the cell has run.
	if (waitForPopup) {
		await expect(infoPopup).toContainText(/execution order/i);
	}
	return infoPopup;
}

async function activateInfoPopup({ app, icon }: { app: Application; icon: Locator }): Promise<Locator> {
	icon.hover({ force: true });
	const popup = app.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' });
	await expect(popup).toBeVisible();
	return popup;
}

test.describe('Cell Execution Info Popup', {
	tag: [tags.CRITICAL, tags.WIN, tags.NOTEBOOKS]
}, () => {
	test.beforeAll(async function ({ app, settings }) {
		await app.positron.notebooksPositron.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.positron.notebooksPositron.setNotebookEditor(settings, 'positron');
	});

	test('Comprehensive cell execution info test - all scenarios in one notebook', async function ({ app }) {
		// Setup: Create notebook and select kernel once
		await app.positron.notebooks.createNewNotebook();

		// Wait for the first cell to be created and visible
		// This is important on CI where timing differences can cause race conditions
		const firstCell = app.code.driver.page.locator('[data-testid="notebook-cell"]').first();
		await expect(firstCell).toBeVisible({ timeout: 5000 });

		await app.positron.notebooksPositron.selectAndWaitForKernel('Python');

		// ========================================
		// Cell 0: Basic popup display with successful execution
		// ========================================
		const popup0 = await executeCodeAndWaitForCompletion(app, 'print("hello world")', 0);

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
		// const icon1 = await executeCodeAndWaitForCompletion(app, 'raise Exception("test error")', 1);
		// await expect(icon1).toBeVisible();

		// // Verify failed execution status
		// await expect(icon1).toHaveAttribute('data-execution-status', 'failed');

		// Verify popup shows failed status
		const popup1 = await executeCodeAndWaitForCompletion(app, 'raise Exception("test error")', 1);
		await expect(popup1).toContainText(/Failed/i);

		// Move mouse away to close popup
		await app.code.driver.page.mouse.move(0, 0);
		await expect(popup1).toBeHidden();

		// ========================================
		// Cell 2: Running execution state display
		// ========================================
		const popup2 = await executeCodeAndWaitForCompletion(app, 'import time; time.sleep(3)', 2, false);

		// Wait for execution to start - spinner should appear in button area
		const cell2 = app.code.driver.page.locator('[data-testid="notebook-cell"]').nth(2);
		const spinner = cell2.getByLabel(/cell is executing/i);
		await expect(spinner).toBeVisible({ timeout: 5000 });

		// Wait for execution info icon to appear during execution and verify running state
		await expect(cell2.locator('[data-execution-status="running"]')).toBeVisible();
		// const icon2 = app.workbench.notebooksPositron.getExecutionInfoIcon(2);
		// await expect(icon2).toBeVisible({ timeout: 3000 });
		// await expect(icon2).toHaveAttribute('data-execution-status', 'running');

		// Verify popup shows running status
		await expect(popup2).toContainText('Currently running...');

		// Move mouse away and wait for execution to complete
		await app.code.driver.page.mouse.move(0, 0);
		await expect(spinner).toHaveCount(0, { timeout: 10000 });

		// ========================================
		// Cell 3: Relative time display
		// ========================================
		// Execute code in a new cell and get the execution info icon
		const icon3 = await executeCodeAndWaitForCompletion(app, 'print("relative time test")', 3);
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
		const popup4 = await executeCodeAndWaitForCompletion(app, 'print("hover test")', 4);

		// Test popup closes when mouse moves away
		await app.code.driver.page.mouse.move(0, 0);
		await expect(popup4).toBeHidden();

		// Test that hovering again after closing still works
		await app.code.driver.page.getByRole('button', { name: 'Execute cell' }).hover();
		await expect(popup4).toBeVisible();

		// ========================================
		// Cleanup
		// ========================================
		// Move mouse away to ensure tooltip is hidden before closing
		await app.code.driver.page.mouse.move(0, 0);
		await expect(app.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' })).toBeHidden();

		// Close the notebook without saving
		await app.positron.notebooks.closeNotebookWithoutSaving();
	});
});
