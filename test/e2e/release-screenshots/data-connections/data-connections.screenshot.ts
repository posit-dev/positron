/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tmpdir } from 'os';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { hideDataGridCursor, overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize, unhoverAll, waitForStableUI } from '../_helpers/layout-utils';

test.use({
	suiteId: __filename,
	// Point the Snowflake driver at a path with no connections.toml, so a file
	// on the machine running the tests doesn't add a "Detected" row to the tree.
	extraEnv: { SNOWFLAKE_HOME: join(tmpdir(), 'release-screenshots-no-snowflake') },
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 1280, height: 800 });
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await app.workbench.hotKeys.closeAllEditors();
	await app.workbench.hotKeys.restoreBottomPanel();
	await app.workbench.hotKeys.showSecondarySidebar();
});

test.describe('Release Screenshots - Data Connections', () => {
	/**
	 * Img Path: https://positron.posit.co/images/data-connections.png
	 *
	 * DuckDB connection expanded in the Data Connections view, showing its
	 * tables and views, with one view open in the Data Explorer.
	 */
	test('Release Screenshot - data-connections.png', async ({ app, page }) => {
		const { dataConnections, dataExplorer, hotKeys, layouts } = app.workbench;

		// create a DuckDB connection to the order_tracking database in the workspace
		await dataConnections.openDataConnectionsView();
		await dataConnections.clickAddConnection();
		await dataConnections.selectProvider('DuckDB');
		await dataConnections.fillConnectionInputs({
			'Connection Name': 'order_tracking',
			'Database File': join(app.workspacePathOrFolder, 'data-files', 'order-tracking', 'order_tracking.duckdb'),
		});
		await dataConnections.save();
		await dataConnections.expectConnectionInTree('order_tracking');

		// expand the tree. The lone `main` schema is hidden, so Tables and
		// Views sit directly under the connection.
		await dataConnections.expandConnection('order_tracking');
		await dataConnections.expandNode('Tables');
		await dataConnections.expandNode('Views');

		// expand the view down to its columns, then open it in the Data Explorer
		await dataConnections.expandNode('v_product_sales');
		await dataConnections.expandNode('Columns');
		await dataConnections.doubleClickNode('v_product_sales');
		await dataExplorer.waitForIdle();

		// give the sidebar and Data Explorer the whole window
		await hotKeys.closeSecondarySidebar();
		await hotKeys.toggleBottomPanel();
		await layouts.expectBottomPanelToBeVisible(false);

		// sort by gross_revenue descending. The view has no ORDER BY, so
		// without a sort the row order changes from run to run.
		// columnIndex is 1-based; gross_revenue is column 6. Its header menu is
		// clipped while the summary panel is open, so hide the panel to sort.
		await hotKeys.hideDataExplorerSummaryPanel();
		await dataExplorer.grid.sortColumnBy(6, 'Sort Descending');
		await dataExplorer.waitForIdle();
		await hotKeys.showDataExplorerSummaryPanel();

		// sorting scrolls the grid right; scroll back to the first column
		await dataExplorer.grid.clickUpperLeftCorner();
		await dataExplorer.grid.jumpToStart();

		// expand the units_sold column profile in the summary panel (0-based row 4)
		await dataExplorer.summaryPanel.expandColumnProfile(4);
		await dataExplorer.waitForIdle();

		// widen the sidebar so the full "order_tracking · DuckDB" label shows
		await layouts.resizeSidebar({ x: 40 });

		// capture screenshot. Click the opened view last so its row shows the
		// active selection highlight. Tree rows have no hover style, and a view
		// has no details page, so the click only selects the row.
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'my-project');
		await page.locator('.positron-tree-row').filter({ has: page.getByText('v_product_sales', { exact: true }) }).click();
		await unhoverAll(page);

		// hide the grid's cell outline. The summary panel's cursor, which the
		// profile expand moved to units_sold, uses a different element and stays.
		await hideDataGridCursor(page);
		await waitForStableUI(page);
		// no baked-in shadow; the docs page adds one with {.drop-shadow}
		await captureFullWindow(page, 'data-connections.png', { shadow: false });
	});
});
