/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

// Python code to create a DataFrame for testing
const createDataFrameCode = "import pandas as pd\ndf = pd.DataFrame({'Name': ['Alice', 'Bob', 'Charlie', 'David', 'Eve'], 'Age': [25, 30, 35, 40, 45], 'City': ['NYC', 'LA', 'Chicago', 'Houston', 'Phoenix']})\ndf";

test.describe('Notebook Inline Data Explorer', {
	tag: [tags.NOTEBOOKS, tags.DATA_EXPLORER, tags.WEB, tags.WIN]
}, () => {

	test.beforeEach(async function ({ app, python }) {
		await app.workbench.layouts.enterLayout('notebook');
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooks.selectInterpreter('Python');
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Verify inline data explorer renders for DataFrame output', async function ({ app }) {
		const { notebooks } = app.workbench;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooks.addCodeToCellAtIndex(0, createDataFrameCode);
			await notebooks.executeCodeInCell();
		});

		await test.step('Verify inline data explorer appears', async () => {
			// The inline data explorer should render with the custom container class
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Verify the header shows correct info
			const header = inlineExplorer.locator('.inline-data-explorer-header');
			await expect(header).toBeVisible();

			// Should show row and column counts
			await expect(header.getByText('5')).toBeVisible(); // 5 rows
			await expect(header.getByText('rows')).toBeVisible();
			await expect(header.getByText('columns')).toBeVisible();

			// Should have the "Open in Data Explorer" button
			const openButton = inlineExplorer.locator('.inline-data-explorer-open-button');
			await expect(openButton).toBeVisible();
		});

		await test.step('Verify data grid content', async () => {
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');

			// The data grid should be rendered
			const dataGrid = inlineExplorer.locator('.positron-data-grid');
			await expect(dataGrid).toBeVisible();

			// Verify some column headers are visible
			await expect(inlineExplorer.getByText('Name')).toBeVisible();
			await expect(inlineExplorer.getByText('Age')).toBeVisible();
			await expect(inlineExplorer.getByText('City')).toBeVisible();
		});
	});

	test('Python - Verify scroll in inline data explorer does not scroll notebook', async function ({ app }) {
		const { notebooks } = app.workbench;
		const page = app.code.driver.page;

		// Create a larger DataFrame to ensure scrollable content in the grid
		const largeDataFrameCode = "import pandas as pd\ndf = pd.DataFrame({'A': range(100), 'B': range(100, 200), 'C': range(200, 300), 'D': range(300, 400), 'E': range(400, 500)})\ndf";

		await test.step('Execute cell with large DataFrame', async () => {
			await notebooks.addCodeToCellAtIndex(0, largeDataFrameCode);
			await notebooks.executeCodeInCell();
		});

		await test.step('Verify inline data explorer appears', async () => {
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });
		});

		await test.step('Scroll within inline data explorer and verify notebook does not scroll', async () => {
			// Get the notebook container's scroll position before
			const notebookContainer = page.locator('.positron-notebook-cells-container');
			const scrollTopBefore = await notebookContainer.evaluate(el => el.scrollTop);

			// Find the inline data explorer content area and hover over it
			const inlineExplorerContent = notebooks.frameLocator.locator('.inline-data-explorer-content');
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
		const { notebooks, editors } = app.workbench;
		const page = app.code.driver.page;

		await test.step('Execute cell that returns a DataFrame', async () => {
			await notebooks.addCodeToCellAtIndex(0, createDataFrameCode);
			await notebooks.executeCodeInCell();
		});

		await test.step('Verify inline data explorer is working', async () => {
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');
			await expect(inlineExplorer).toBeVisible({ timeout: 15000 });

			// Verify data is displayed
			await expect(inlineExplorer.getByText('Alice')).toBeVisible();
		});

		await test.step('Open full Data Explorer', async () => {
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');
			const openButton = inlineExplorer.locator('.inline-data-explorer-open-button');
			await openButton.click();

			// Verify Data Explorer tab opens
			await editors.verifyTab('Data: df', { isVisible: true });
		});

		await test.step('Close full Data Explorer and return to notebook', async () => {
			// Click the Data Explorer tab to make sure it's active
			await editors.clickTab('Data: df');

			// Close the current tab (the Data Explorer)
			await hotKeys.closeTab();

			// Return to the notebook
			const notebookTab = page.locator('.tab').filter({ hasText: 'Untitled' });
			if (await notebookTab.isVisible()) {
				await notebookTab.click();
			}
		});

		await test.step('Verify inline data explorer still works after returning', async () => {
			const inlineExplorer = notebooks.frameLocator.locator('.inline-data-explorer-container');

			// The inline explorer should still be visible and functional
			await expect(inlineExplorer).toBeVisible({ timeout: 10000 });

			// Verify it's not showing an error state
			const errorState = inlineExplorer.locator('.inline-data-explorer-error');
			await expect(errorState).not.toBeVisible();

			// Verify the data grid is still showing content
			const dataGrid = inlineExplorer.locator('.positron-data-grid');
			await expect(dataGrid).toBeVisible();

			// Verify data is still accessible
			await expect(inlineExplorer.getByText('Alice')).toBeVisible();
		});
	});
});
