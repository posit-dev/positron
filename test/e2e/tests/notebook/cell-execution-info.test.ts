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
		await app.workbench.notebooks.enablePositronNotebooks(settings);
		// Configure Positron as the notebook editor
		await app.workbench.notebooks.setNotebookEditor(settings, 'positron');
	});

	test.describe('Python Notebooks - Execution Info', () => {
		test.beforeEach(async function ({ app, settings }) {
			await app.workbench.notebooks.createNewNotebook();
			// Make sure kernel is ready to go before we start trying to run code
			await app.workbench.notebooksPositron.selectAndWaitForKernel('Python');
		});

		test.afterEach(async function ({ app, settings }) {
			// For some reason playwright has a hard time running command pallete commands when the tooltip is visible.
			// This is not a problem when running manually.
			await app.code.driver.page.mouse.move(0, 0); // Move mouse away
			await expect(app.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' })).toBeHidden();

			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});


		test('Basic popup display with successful execution and duration formatting', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("hello world")');
			const popup = await activateInfoPopup({ app, icon });

			// Verify popup content shows execution info
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
			// Verify popup shows failed status
			const popup = await activateInfoPopup({ app, icon });
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
			const popup = await activateInfoPopup({ app, icon });

			// Verify popup shows running status
			await expect(popup).toContainText('Currently running...');
		});

		test('Relative time display', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("relative time test")');
			const popup = await activateInfoPopup({ app, icon });

			// Verify relative time is displayed (should show recent execution)
			// Some renderers may insert non-breaking spaces between words. Use \s to match any whitespace.
			await expect(popup).toContainText(/(?:seconds?\s+ago|just\s+now)/i);
		});

		test('Hover timing and interaction', async function ({ app }) {
			// Execute code and get the execution info icon
			const icon = await executeCodeAndWaitForIcon(app, 'print("hover test")');
			const popup = await activateInfoPopup({ app, icon });

			// Test popup closes when mouse moves away
			await app.code.driver.page.mouse.move(0, 0);
			await expect(popup).toBeHidden();

			// Test that hovering again after closing still works
			await icon.hover();
			await expect(popup).toBeVisible();
		});
	});
});
