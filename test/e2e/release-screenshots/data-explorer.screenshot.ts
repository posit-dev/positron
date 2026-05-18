/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect } from '@playwright/test';
import { test } from '../tests/_test.setup';
import { capturePanel, captureRegion } from './helpers/screenshot-utils';
import { hideNotificationBadges, hideToasts, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

// Restore the bottom panel and secondary sidebar so the python fixture for
// the next test can start a session (maximize() closes both panels).
// Press Escape first so any open popup (e.g. column/cell/row menus) does not
// intercept the layout-restore keyboard shortcuts.
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
		const { dataExplorer, variables } = app.workbench;

		// open the flights dataset in the data explorer
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
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

		// Sort by month descending. columnIndex is 1-based; month is column 2.
		await dataExplorer.grid.sortColumnBy(2, 'Sort Descending');
		await dataExplorer.waitForIdle();

		// Expand the arr_delay column profile in the summary panel.
		await dataExplorer.summaryPanel.expandColumnProfile(8);

		// capture screenshot
		await prepareForScreenshot(app, page);
		await capturePanel(
			page,
			page.locator('.part.editor .editor-group-container'),
			'data-explorer.png',
		);
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-grid-example.png
	 */
	test('Release Screenshot - data-explorer-grid-example.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();

		await prepareForScreenshot(app, page);
		await capturePanel(
			page,
			page.locator('.part.editor .editor-group-container'),
			'data-explorer-grid-example.png',
		);
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-column-menu.png
	 */
	test('Release Screenshot - data-explorer-column-menu.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();

		// Dismiss UI noise before opening the menu so it doesn't appear in the screenshot
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Click the ⋮ button on the "day" column header (0-based index 2)
		const menuPopup = await dataExplorer.grid.openColumnContextMenu(2);

		// Capture a region: from the left edge of the "month" column (data-column-index="1"),
		// starting at the column headers row, and ending just below the bottom of the open menu.
		// Anchoring to month (rather than a fixed pixel offset) ensures the year column stays
		// off the left edge of the screenshot regardless of column widths.
		const menuBox = await menuPopup.boundingBox();
		const headersBox = await page.locator('.data-grid-column-headers').boundingBox();
		const monthHeaderBox = await page.locator('.data-grid-column-header[data-column-index="1"]').boundingBox();
		if (!menuBox || !headersBox) {
			throw new Error('Could not measure bounding boxes for column menu screenshot');
		}
		const PADDING = 12;
		const startX = monthHeaderBox ? monthHeaderBox.x : Math.max(0, menuBox.x - 220);
		await captureRegion(page, 'data-explorer-column-menu.png', {
			x: startX,
			y: headersBox.y,
			width: menuBox.x + menuBox.width - startX + PADDING,
			height: menuBox.y + menuBox.height - headersBox.y + PADDING,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-cell-menu.png
	 */
	test('Release Screenshot - data-explorer-cell-menu.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();

		// Dismiss UI noise before opening the menu
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Right-click the year column cell in row 0
		const menuPopup = await dataExplorer.grid.openCellContextMenu(0, 0);

		// Capture from the row-headers left edge through the full open menu
		const menuBox = await menuPopup.boundingBox();
		const rowHeadersBox = await page.locator('.data-grid-row-headers').boundingBox();
		const headersBox = await page.locator('.data-grid-column-headers').boundingBox();
		if (!menuBox) {
			throw new Error('Could not measure bounding box for cell menu screenshot');
		}
		const PADDING = 12;
		const startX = rowHeadersBox ? rowHeadersBox.x : Math.max(0, menuBox.x - 100);
		const startY = headersBox ? headersBox.y : Math.max(0, menuBox.y - 60);
		await captureRegion(page, 'data-explorer-cell-menu.png', {
			x: startX,
			y: startY,
			width: menuBox.x + menuBox.width - startX + PADDING,
			height: menuBox.y + menuBox.height - startY + PADDING,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/data-explorer-cell-value-tooltip.png
	 */
	test('Release Screenshot - data-explorer-cell-value-tooltip.png', async ({ app, page, executeCode, python }) => {
		const { dataExplorer, variables } = app.workbench;
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();

		// Navigate to the time_hour column (last column, index 18) via keyboard
		await dataExplorer.grid.clickCell(0, 0);
		await page.keyboard.press('End');
		await dataExplorer.waitForIdle();

		// Wait for time_hour column header to be rendered before hovering over a cell
		await dataExplorer.grid.waitForColumnHeader(18);

		// Narrow the time_hour column so its value is truncated (auto-sizing fits the full
		// "2013-01-01 05:00:00" string, so offsetWidth >= scrollWidth and no tooltip fires).
		// Drag the right-edge sash ~50px left: enough to truncate the cell value while keeping
		// the "time_hour" column header title fully visible.
		const timeHourHeader = page.locator('.data-grid-column-header[data-column-index="18"]');
		const headerBox = await timeHourHeader.boundingBox();
		if (!headerBox) {
			throw new Error('Could not find time_hour column header bounding box');
		}
		const sashX = headerBox.x + headerBox.width - 2;
		const sashY = headerBox.y + headerBox.height / 2;
		await page.mouse.move(sashX, sashY);
		await page.mouse.down();
		await page.mouse.move(sashX - 50, sashY, { steps: 10 });
		await page.mouse.up();
		await dataExplorer.waitForIdle();

		// Hover over the first time_hour cell to trigger the truncation tooltip
		await hideToasts(app);
		await hideNotificationBadges(page);
		const timeHourCell = page.locator('#data-grid-row-cell-content-18-0 .text-value');
		await timeHourCell.scrollIntoViewIfNeeded();
		await timeHourCell.hover();
		// The hover manager has a 500ms delay before showing the tooltip
		await page.waitForTimeout(700);

		const tooltip = page.locator('.hover-contents');
		await expect(tooltip).toBeVisible({ timeout: 10000 });

		// Capture a tight region: column headers row + surrounding cells + tooltip
		const tooltipBox = await tooltip.boundingBox();
		const cellBox = await timeHourCell.boundingBox();
		const headersBox = await page.locator('.data-grid-column-headers').boundingBox();
		if (!tooltipBox || !cellBox) {
			throw new Error('Could not measure bounding boxes for cell value tooltip screenshot');
		}
		const PADDING = 16;
		const startX = Math.max(0, Math.min(tooltipBox.x, cellBox.x) - PADDING);
		const startY = headersBox
			? headersBox.y
			: Math.max(0, Math.min(tooltipBox.y, cellBox.y) - PADDING);
		const endX = Math.max(tooltipBox.x + tooltipBox.width, cellBox.x + cellBox.width) + PADDING;
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
		const { dataExplorer, variables } = app.workbench;
		const parquetPath = join(
			app.workspacePathOrFolder,
			'data-files',
			'flights',
			'flights.parquet',
		);
		await executeCode(
			'Python',
			`
import pandas as pd
flights = pd.read_parquet(r'${parquetPath}', engine='pyarrow')
`.trim(),
		);
		await variables.waitForVariableRow('flights');
		await variables.doubleClickVariableRow('flights');
		await dataExplorer.maximize(false);
		await dataExplorer.waitForIdle();
		await dataExplorer.filters.clearAll();
		await dataExplorer.waitForIdle();

		// Dismiss UI noise before opening the menu
		await hideToasts(app);
		await hideNotificationBadges(page);

		// Right-click on row header index 1 (the second row, shown as "1" in the UI)
		const menuPopup = await dataExplorer.grid.openRowContextMenu(1);

		// Capture from the row-headers left edge through the first few data columns and the menu
		const menuBox = await menuPopup.boundingBox();
		const rowHeadersBox = await page.locator('.data-grid-row-headers').boundingBox();
		const headersBox = await page.locator('.data-grid-column-headers').boundingBox();
		if (!menuBox) {
			throw new Error('Could not measure bounding box for row menu screenshot');
		}
		const PADDING = 12;
		const COL_CONTEXT = 240;
		const startX = rowHeadersBox ? rowHeadersBox.x : Math.max(0, menuBox.x - 60);
		const startY = headersBox ? headersBox.y : Math.max(0, menuBox.y - 60);
		const endX = Math.max(
			menuBox.x + menuBox.width,
			(rowHeadersBox ? rowHeadersBox.x + rowHeadersBox.width : menuBox.x) + COL_CONTEXT,
		) + PADDING;
		await captureRegion(page, 'data-explorer-row-menu.png', {
			x: startX,
			y: startY,
			width: endX - startX,
			height: menuBox.y + menuBox.height - startY + PADDING,
		});
	});
});
