/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { hideDataGridCursor, hideNotificationBadges, hideToasts, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';

type ExecuteCode = (
	language: 'Python' | 'R',
	code: string,
	options?: { timeout?: number; waitForReady?: boolean; maximizeConsole?: boolean },
) => Promise<void>;

type AppShim = {
	workspacePathOrFolder: string;
	workbench: { variables: { waitForVariableRow(name: string): Promise<unknown>; doubleClickVariableRow(name: string): Promise<unknown> } };
};

async function openFlightsDataset(app: AppShim, executeCode: ExecuteCode): Promise<void> {
	const parquetPath = join(app.workspacePathOrFolder, 'data-files', 'flights', 'flights.parquet');
	await executeCode('Python', `import pandas as pd\nflights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')`);
	await app.workbench.variables.waitForVariableRow('flights');
	await app.workbench.variables.doubleClickVariableRow('flights');
}

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await app.workbench.hotKeys.restoreBottomPanel();
	await app.workbench.hotKeys.showSecondarySidebar();
});

/**
 * Img Path: https://positron.posit.co/images/data-explorer.png
 */
test.describe('Release Screenshots - Data Explorer', () => {
	test('Release Screenshot - data-explorer.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer } = app.workbench;

		await openFlightsDataset(app, executeCode);
		await dataExplorer.maximize(true);
		await dataExplorer.waitForIdle();

		// apply filter: dep_time is not missin
		await dataExplorer.filters.add({
			columnName: 'dep_time',
			condition: 'is not missing',
		});
		await dataExplorer.waitForIdle();

		// apply filter: month is greater than 1
		await dataExplorer.filters.add({
			columnName: 'month',
			condition: 'is greater than',
			value: '1',
		});
		await dataExplorer.waitForIdle();

		// sort by month descending. columnIndex is 1-based; month is column 2.
		await dataExplorer.grid.sortColumnBy(2, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// expand the arr_delay column profile in the summary panel.
		await dataExplorer.summaryPanel.expandColumnProfile(8);

		// capture screenshot
		await prepareForScreenshot(app, page);
		const editorBox = await page.locator('.part.editor .editor-group-container').boundingBox();
		const statusbarBox = await page.locator('.part.statusbar').boundingBox();
		if (!editorBox || !statusbarBox) {
			throw new Error('Could not measure editor group / status bar for data-explorer capture');
		}
		await captureRegion(page, 'data-explorer.png', {
			x: editorBox.x,
			y: editorBox.y,
			width: editorBox.width,
			height: Math.ceil(statusbarBox.y - editorBox.y),
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-grid-example.png
	 */
	test('Release Screenshot - data-explorer-grid-example.png', async ({ app, page, executeCode, python }) => {

		// open the data explorer with the flights dataset
		const { dataExplorer } = app.workbench;
		await openFlightsDataset(app, executeCode);

		// Maximize the data explorer and clear filters
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();

		// Move the cursor past the crop boundary (columns 0–5) so no blue cell outline appears.
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}



		// Capture just the top-left corner of the grid
		await prepareForScreenshot(app, page);
		const headersBox = await dataExplorer.grid.columnHeadersContainer.boundingBox();
		const depDelayHeader = await dataExplorer.grid.columnHeaderByIndex(5).boundingBox();
		const fifthRowBox = await dataExplorer.grid.dataRow(4).boundingBox();
		if (!headersBox || !depDelayHeader || !fifthRowBox) {
			throw new Error('Could not measure bounding boxes for grid example screenshot');
		}
		const PADDING = 2;
		await captureRegion(page, 'data-explorer-grid-example.png', {
			x: headersBox.x,
			y: headersBox.y,
			width: depDelayHeader.x + depDelayHeader.width - headersBox.x + PADDING,
			height: fifthRowBox.y + fifthRowBox.height - headersBox.y + PADDING,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-column-menu.png
	 */
	test('Release Screenshot - data-explorer-column-menu.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer } = app.workbench;

		// open the data explorer with the flights dataset
		await openFlightsDataset(app, executeCode);
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();

		// Clear filters and jump to the top-left cell
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();

		// Move the cursor past the crop boundary (columns 0–2) so no blue cell outline appears.
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('ArrowRight');
		}

		// Dismiss UI noise before opening the menu so it doesn't appear in the screenshot
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Click the ⋮ button on the "month" column header (0-based index 1)
		const menuPopup = await dataExplorer.grid.openColumnContextMenu(1);

		// Capture from the left edge of the month column through the right edge of the day column
		const menuBox = await menuPopup.boundingBox();
		const headersBox = await dataExplorer.grid.columnHeadersContainer.boundingBox();
		const monthHeaderBox = await dataExplorer.grid.columnHeaderByIndex(1).boundingBox();
		const dayHeaderBox = await dataExplorer.grid.columnHeaderByIndex(2).boundingBox();
		if (!menuBox || !headersBox || !monthHeaderBox || !dayHeaderBox) {
			throw new Error('Could not measure bounding boxes for column menu screenshot');
		}
		const PADDING = 2;
		const startX = monthHeaderBox.x;
		const endX = Math.max(
			menuBox.x + menuBox.width,
			dayHeaderBox.x + dayHeaderBox.width,
		) + PADDING;
		await captureRegion(page, 'data-explorer-column-menu.png', {
			x: startX,
			y: headersBox.y,
			width: endX - startX,
			height: menuBox.y + menuBox.height - headersBox.y + PADDING,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-cell-menu.png
	 */
	test('Release Screenshot - data-explorer-cell-menu.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer } = app.workbench;

		// open the data explorer with the flights dataset
		await openFlightsDataset(app, executeCode);
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();

		// Clear filters and jump to the top-left cell
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();

		// Dismiss UI noise before opening the menu
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Right-click the year column cell in row 0
		const menuPopup = await dataExplorer.grid.openCellContextMenu(0, 0);

		// Capture region
		const menuBox = await menuPopup.boundingBox();
		const splitterBox = await dataExplorer.grid.splitter.boundingBox();
		const headersBox = await dataExplorer.grid.columnHeadersContainer.boundingBox();
		const dayHeaderBox = await dataExplorer.grid.columnHeaderByIndex(2).boundingBox();
		const row12Box = await dataExplorer.grid.dataRow(12).boundingBox();
		if (!menuBox || !splitterBox || !headersBox || !dayHeaderBox || !row12Box) {
			throw new Error('Could not measure bounding boxes for cell menu screenshot');
		}
		const PADDING = 2;
		const LEFT_BLEED = 8;
		const startX = Math.max(0, splitterBox.x - LEFT_BLEED);
		const startY = headersBox.y;
		const endX = Math.max(
			menuBox.x + menuBox.width,
			dayHeaderBox.x + dayHeaderBox.width,
		) + PADDING;
		const endY = Math.max(
			menuBox.y + menuBox.height,
			row12Box.y + row12Box.height,
		) + PADDING;
		await captureRegion(page, 'data-explorer-cell-menu.png', {
			x: startX,
			y: startY,
			width: endX - startX,
			height: endY - startY,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-cell-value-tooltip.png
	 */
	test('Release Screenshot - data-explorer-cell-value-tooltip.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer } = app.workbench;

		// open the data explorer with the flights dataset
		await openFlightsDataset(app, executeCode);
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();

		// clear filters and navigte to the time_hour column (last column, index 18)
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();
		await page.keyboard.press('End');
		await dataExplorer.waitForIdle();

		// Wait for time_hour column header to be visible, then narrow it so the cell value truncates
		await dataExplorer.grid.waitForColumnHeader(18);
		await dataExplorer.grid.narrowColumnBySash(18, 50);
		await dataExplorer.waitForIdle();

		// Hover over the first time_hour cell to trigger the truncation tooltip
		await hideToasts(app);
		await hideNotificationBadges(page);
		await hideDataGridCursor(page);
		const timeHourCell = dataExplorer.grid.cellTextValue(18, 0);
		await timeHourCell.scrollIntoViewIfNeeded();
		await timeHourCell.hover();
		// The hover manager has a 500ms delay before showing the tooltip
		await page.waitForTimeout(700);

		const tooltip = page.locator('.hover-contents');
		await expect(tooltip).toBeVisible({ timeout: 10000 });

		// Capture a tight region: column headers row + surrounding cells + tooltip
		const tooltipBox = await tooltip.boundingBox();
		const cellBox = await timeHourCell.boundingBox();
		const headersBox = await dataExplorer.grid.columnHeadersContainer.boundingBox();
		const timeHourHeaderBox = await dataExplorer.grid.columnHeaderByIndex(18).boundingBox();
		if (!tooltipBox || !cellBox || !headersBox || !timeHourHeaderBox) {
			throw new Error('Could not measure bounding boxes for cell value tooltip screenshot');
		}
		const PADDING = 16;
		const RIGHT_PADDING = 40;
		const startX = Math.max(0, Math.min(tooltipBox.x, cellBox.x) - PADDING);
		const startY = headersBox.y;
		const endX = Math.max(
			tooltipBox.x + tooltipBox.width,
			cellBox.x + cellBox.width,
			timeHourHeaderBox.x + timeHourHeaderBox.width,
		) + RIGHT_PADDING;
		const endY = Math.max(tooltipBox.y + tooltipBox.height, cellBox.y + cellBox.height) + PADDING;
		await captureRegion(page, 'data-explorer-cell-value-tooltip.png', {
			x: startX,
			y: startY,
			width: endX - startX,
			height: endY - startY,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-row-menu.png
	 */
	test('Release Screenshot - data-explorer-row-menu.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer } = app.workbench;

		// open the data explorer with the flights dataset
		await openFlightsDataset(app, executeCode);
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();

		// Clear filters and jump to the top-left cell
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();

		// Dismiss UI noise before opening the menu
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Right-click on row header index 1 (the second row, shown as "1" in the UI)
		const menuPopup = await dataExplorer.grid.openRowContextMenu(1);

		// Capture screenshot region
		const menuBox = await menuPopup.boundingBox();
		const rowHeadersBox = await dataExplorer.grid.rowHeadersContainer.boundingBox();
		const monthHeaderBox = await dataExplorer.grid.columnHeaderByIndex(1).boundingBox();
		const row0Box = await dataExplorer.grid.dataRow(0).boundingBox();
		const row6Box = await dataExplorer.grid.dataRow(6).boundingBox();
		if (!menuBox) {
			throw new Error('Could not measure bounding box for row menu screenshot');
		}
		const PADDING = 2;
		const startX = rowHeadersBox ? rowHeadersBox.x : Math.max(0, menuBox.x - 60);
		const startY = row0Box ? row0Box.y : Math.max(0, menuBox.y - 60);
		const endX = Math.max(
			menuBox.x + menuBox.width,
			monthHeaderBox ? monthHeaderBox.x + monthHeaderBox.width : 0,
		) + PADDING;
		const endY = Math.max(
			menuBox.y + menuBox.height,
			row6Box ? row6Box.y + row6Box.height : 0,
		) + PADDING;
		await captureRegion(page, 'data-explorer-row-menu.png', {
			x: startX,
			y: startY,
			width: endX - startX,
			height: endY - startY,
		});
	});
});
