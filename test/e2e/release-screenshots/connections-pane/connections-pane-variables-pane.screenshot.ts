/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureRegion } from '../_helpers/screenshot-utils';
import { prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app, page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await app.workbench.connections.navigateBack();
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Connections Pane Variables Pane', () => {
	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-variables-pane.png
	 *
	 * Cropped capture of the Variables view showing a Python `conn` variable
	 * with the database-icon "open in Connections pane" button highlighted.
	 */
	test('Release Screenshot - connections-pane-variables-pane.png', async ({ app, page, openFile, executeCode, python }) => {
		const { variables, hotKeys, layouts } = app.workbench;
		await app.workbench.sessions.expectAllSessionsToBeReady();

		const scriptRel = join('workspaces', 'chinook-db-py', 'chinook-sqlite.py');
		await openFile(scriptRel);
		const script = `import sqlite3\nconn = sqlite3.connect("${app.workspacePathOrFolder}/data-files/chinook/chinook.db")`;
		await executeCode('Python', script, { maximizeConsole: false });

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.showSecondarySidebar();
		await variables.focusVariablesView();
		await layouts.resizeAuxiliaryBar({ x: -150 });

		const connRow = variables.variableRow('conn');
		const dbIcon = connRow.locator('.right-column .viewer-icon.codicon-database');
		await expect(dbIcon).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.right-column .viewer-icon.codicon-database', label: '', color: ANNOTATION_COLOR, padding: 6, borderWidth: 3 },
		]);

		// crop tightly to the aux-bar
		const auxBar = page.locator('.part.auxiliarybar');
		const auxBox = await auxBar.boundingBox();
		const connRowBox = await connRow.boundingBox();
		if (!auxBox || !connRowBox) {
			throw new Error('Could not measure aux bar / conn row');
		}
		const bottom = Math.ceil(connRowBox.y + connRowBox.height + 12);
		await captureRegion(page, 'connections-pane-variables-pane.png', {
			x: Math.floor(auxBox.x),
			y: Math.floor(auxBox.y),
			width: Math.ceil(auxBox.width),
			height: bottom - Math.floor(auxBox.y),
		});
	});
});
