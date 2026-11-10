/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { Application } from '../../infra';

test.use({
	suiteId: __filename,
});

// A smaller window keeps the Value column and the space below the tree from
// trailing off into empty space.
test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app, { width: 850, height: 560 });
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await app.workbench.hotKeys.closeAllEditors();
	await app.workbench.hotKeys.restoreBottomPanel();
	await app.workbench.hotKeys.showSecondarySidebar();
});

const RESULTS = `import pandas as pd
results = {
    "experiment": "pricing-test-q3",
    "config": {
        "variants": ["control", "discount_10", "discount_20"],
        "metric": "conversion_rate",
        "alpha": 0.05,
    },
    "segments": {
        "new_customers": {"n": 4210, "lift": 0.032, "p_value": 0.011},
        "returning_customers": {"n": 9875, "lift": 0.008, "p_value": 0.214},
    },
    "daily": pd.DataFrame({
        "day": pd.date_range("2026-07-01", periods=30),
        "visitors": range(1000, 1030),
        "conversions": range(40, 70),
    }),
    "notes": "The discount variants raised conversion among new customers. Returning customers showed no significant change.",
}`;

/**
 * Opens `results` in the Object Explorer, with the editor filling the window.
 */
async function openResults(app: Application, executeCode: (language: 'Python', code: string, options?: { maximizeConsole?: boolean }) => Promise<void>): Promise<void> {
	const { hotKeys, objectExplorer } = app.workbench;
	await executeCode('Python', RESULTS);
	await executeCode('Python', '%view results', { maximizeConsole: false });

	await hotKeys.closeSecondarySidebar();
	await hotKeys.closePrimarySidebar();
	await hotKeys.toggleBottomPanel();
	await objectExplorer.expectRow('segments');
}

/**
 * Captures the editor group, from its tabs to the workbench status bar.
 */
async function captureEditor(page: Page, filename: string): Promise<void> {
	const editorBox = await page.locator('.part.editor .editor-group-container').boundingBox();
	const statusbarBox = await page.locator('.part.statusbar').boundingBox();
	if (!editorBox || !statusbarBox) {
		throw new Error(`Could not measure the editor group for ${filename}`);
	}
	await captureRegion(page, filename, {
		x: editorBox.x,
		y: editorBox.y,
		width: editorBox.width,
		height: Math.ceil(statusbarBox.y - editorBox.y),
	});
}

test.describe('Release Screenshots - Object Explorer', () => {
	/**
	 * Img Path: https://positron.posit.co/images/object-explorer.png
	 *
	 * A nested Python dict with a selected value, whose accessor shows in the
	 * status bar.
	 */
	test('Release Screenshot - object-explorer.png', async ({ app, page, executeCode, python }) => {
		const { objectExplorer } = app.workbench;
		await openResults(app, executeCode);

		await objectExplorer.expandRow('config');
		await objectExplorer.expandRow('segments');
		await objectExplorer.expandRow('new_customers');
		await objectExplorer.selectRow('lift');
		await objectExplorer.expectStatus(`results['segments']['new_customers']['lift']`);

		await prepareForScreenshot(app, page);
		await captureEditor(page, 'object-explorer.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/object-explorer-context-menu.png
	 *
	 * The context menu of a row holding a data frame.
	 */
	test('Release Screenshot - object-explorer-context-menu.png', async ({ app, page, executeCode, python }) => {
		const { objectExplorer } = app.workbench;
		await openResults(app, executeCode);

		await prepareForScreenshot(app, page);
		const menu = await objectExplorer.openRowContextMenu('daily');

		// Crop from the column headers to the bottom right of the menu.
		const PADDING = 8;
		const headersBox = await objectExplorer.container.locator('.object-explorer-column-headers').boundingBox();
		const menuBox = await menu.boundingBox();
		if (!headersBox || !menuBox) {
			throw new Error('Could not measure the tree and menu for object-explorer-context-menu.png');
		}
		await captureRegion(page, 'object-explorer-context-menu.png', {
			x: headersBox.x,
			y: headersBox.y,
			width: menuBox.x + menuBox.width + PADDING - headersBox.x,
			height: menuBox.y + menuBox.height + PADDING - headersBox.y,
		});
	});

	/**
	 * Img Path: https://positron.posit.co/images/object-explorer-search.png
	 *
	 * The results of a search that matches values at different depths.
	 */
	test('Release Screenshot - object-explorer-search.png', async ({ app, page, executeCode, python }) => {
		const { objectExplorer } = app.workbench;
		await openResults(app, executeCode);

		await objectExplorer.search('discount');
		await expect(objectExplorer.container.getByTestId('object-explorer-search-footer')).toBeVisible();
		await objectExplorer.searchBox.blur();

		await prepareForScreenshot(app, page);
		await captureEditor(page, 'object-explorer-search.png');
	});
});
