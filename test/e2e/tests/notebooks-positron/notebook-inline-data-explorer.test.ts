/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

// Python code to create a DataFrame for testing
const createDataFrameCode = "import pandas as pd\ndf = pd.DataFrame({'Name': ['Alice', 'Bob', 'Charlie', 'David', 'Eve'], 'Age': [25, 30, 35, 40, 45], 'City': ['NYC', 'LA', 'Chicago', 'Houston', 'Phoenix']})\ndf";

test.describe('Positron Notebooks: Inline Data Explorer', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.DATA_EXPLORER, tags.WEB, tags.WIN]
}, () => {

	test.beforeEach(async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;
		await app.workbench.layouts.enterLayout('notebook');
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');
	});

	test('Python - Verify inline data explorer renders for DataFrame output', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify inline data explorer appears', async () => {
			// The inline data explorer renders directly in Positron notebook output (not in iframe)
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Verify the header shows correct info
			const header = inlineExplorer.locator('.inline-data-explorer-header');
			await expect(header).toBeVisible();

			// Should show row and column counts in the shape span
			const shape = header.locator('.inline-data-explorer-shape');
			await expect(shape).toContainText('5');
			await expect(shape).toContainText('rows');
			await expect(shape).toContainText('columns');

			// Should have the "Open in Data Explorer" button
			const openButton = inlineExplorer.locator('.inline-data-explorer-open-button');
			await expect(openButton).toBeVisible();
		});

		await test.step('Verify data grid content', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');

			// The data grid should be rendered
			const dataGrid = inlineExplorer.locator('.data-grid');
			await expect(dataGrid).toBeVisible();

			// Verify some column headers are visible
			await expect(inlineExplorer.getByText('Name')).toBeVisible();
			await expect(inlineExplorer.getByText('Age')).toBeVisible();
			await expect(inlineExplorer.getByText('City')).toBeVisible();
		});
	});

	test('Python - Verify scroll in inline data explorer does not scroll notebook', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const page = app.code.driver.page;

		// Create a larger DataFrame to ensure scrollable content in the grid
		const largeDataFrameCode = "import pandas as pd\ndf = pd.DataFrame({'A': range(100), 'B': range(100, 200), 'C': range(200, 300), 'D': range(300, 400), 'E': range(400, 500)})\ndf";

		await test.step('Execute cell with large DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, largeDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify inline data explorer appears', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });
		});

		await test.step('Scroll within inline data explorer and verify notebook does not scroll', async () => {
			// Get the notebook container's scroll position before
			const notebookContainer = page.locator('.positron-notebook-cells-container');
			const scrollTopBefore = await notebookContainer.evaluate(el => el.scrollTop);

			// Find the inline data explorer content area and scroll within it
			const inlineExplorerContent = page.locator('.inline-data-explorer-content');
			const box = await inlineExplorerContent.boundingBox();

			if (box) {
				// Move mouse to center of inline data explorer content
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

				// Perform wheel scroll
				await page.mouse.wheel(0, 100);
			}

			// Small wait for any scroll to process
			await page.waitForTimeout(200);

			// Verify notebook scroll position hasn't changed significantly
			// (allow small tolerance for potential rounding)
			const scrollTopAfter = await notebookContainer.evaluate(el => el.scrollTop);
			expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThan(5);
		});
	});

	test('Python - Verify open full Data Explorer and return to inline view', async function ({ app, hotKeys }) {
		const { notebooksPositron, editors } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Verify inline data explorer is working', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Verify data is displayed
			await expect(inlineExplorer.getByText('Alice')).toBeVisible();
		});

		await test.step('Open full Data Explorer', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			const openButton = inlineExplorer.locator('.inline-data-explorer-open-button');
			await openButton.click();

			// Wait for Data Explorer tab to open - the tab name includes "df"
			const dataExplorerTab = page.getByRole('tab', { name: /df/i });
			await expect(dataExplorerTab).toBeVisible({ timeout: 15000 });
		});

		await test.step('Close full Data Explorer and return to notebook', async () => {
			// The Data Explorer tab should be active, close it
			await hotKeys.closeTab();

			// Return to the notebook
			const notebookTab = page.locator('.tab').filter({ hasText: 'Untitled' });
			if (await notebookTab.isVisible()) {
				await notebookTab.click();
			}
		});

		await test.step('Verify inline data explorer still works after returning', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');

			// The inline explorer should still be visible and functional
			await expect(inlineExplorer).toBeVisible({ timeout: 10000 });

			// Verify it's not showing an error state
			const errorState = inlineExplorer.locator('.inline-data-explorer-error');
			await expect(errorState).not.toBeVisible();

			// Verify the data grid is still showing content
			const dataGrid = inlineExplorer.locator('.data-grid');
			await expect(dataGrid).toBeVisible();

			// Verify data is still accessible
			await expect(inlineExplorer.getByText('Alice')).toBeVisible();
		});
	});

	test('Python - Copy single cell to clipboard', async function ({ app }) {
		const { notebooksPositron, clipboard } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Click on a cell and copy', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Click on "Alice" cell (first data cell in Name column)
			// The cell content is inside .data-grid-row-cell .content
			const aliceCell = inlineExplorer.locator('.data-grid-row-cell .content').filter({ hasText: 'Alice' });
			await aliceCell.click();

			// Copy and verify
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe('Alice');
		});
	});

	test('Python - Copy cell range to clipboard', async function ({ app }) {
		const { notebooksPositron, clipboard } = app.workbench;
		const page = app.code.driver.page;

		const code = `import pandas as pd
df = pd.DataFrame({'A': [1, 2, 3], 'B': [4, 5, 6]})
df`;

		await test.step('Execute cell with DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, code, { run: true, waitForSpinner: true });
		});

		await test.step('Select a range and copy', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Click first cell (value "1") to set start of selection
			const firstCell = inlineExplorer.locator('.data-grid-row-cell .content').filter({ hasText: /^1$/ }).first();
			await firstCell.click();

			// Shift+click to extend selection to cell with value "5" (2x2 range)
			const lastCell = inlineExplorer.locator('.data-grid-row-cell .content').filter({ hasText: /^5$/ });
			await lastCell.click({ modifiers: ['Shift'] });

			// Copy and verify TSV format (columns tab-separated, rows newline-separated)
			await clipboard.copy();
			await clipboard.expectClipboardTextToBe('A\tB\n1\t4\n2\t5', '\n');
		});
	});

	test('Python - Copy column via context menu', async function ({ app }) {
		const { notebooksPositron, clipboard } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Right-click column header and copy', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Right-click on "Name" column header
			const nameHeader = inlineExplorer.locator('.data-grid-column-header').filter({ hasText: 'Name' });
			await nameHeader.click({ button: 'right' });

			// Click "Copy Column" in context menu
			const contextMenu = page.locator('.positron-modal-popup');
			await contextMenu.getByText('Copy Column').click();

			// Verify clipboard contains the column data
			await clipboard.expectClipboardTextToBe('Name\nAlice\nBob\nCharlie\nDavid\nEve', '\n');
		});
	});

	test('Python - Copy row via context menu', async function ({ app }) {
		const { notebooksPositron, clipboard } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooksPositron.addCodeToCell(0, createDataFrameCode, { run: true, waitForSpinner: true });
		});

		await test.step('Right-click row header and copy', async () => {
			const inlineExplorer = page.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Right-click on first row header (row index 0)
			const rowHeader = inlineExplorer.locator('.data-grid-row-header').first();
			await rowHeader.click({ button: 'right' });

			// Click "Copy Row" in context menu
			const contextMenu = page.locator('.positron-modal-popup');
			await contextMenu.getByText('Copy Row').click();

			// Verify clipboard contains header + first data row
			await clipboard.expectClipboardTextToBe('Name\tAge\tCity\nAlice\t25\tNYC', '\n');
		});
	});
});
