/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { clearAnnotations } from '../_helpers/annotate-utils';

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Connections Pane New Connection', () => {
	/**
	 * Img Path: https://positron.posit.co/images/connections-pane-new-connection.png
	 *
	 * The "New Connection" modal with the PostgreSQL driver selected so the
	 * connection-details form (Database, Host, Port, User, Password) is visible.
	 */
	test('Release Screenshot - connections-pane-new-connection.png', async ({ app, page, r }) => {
		const { hotKeys, connections, layouts } = app.workbench;
		await app.workbench.sessions.expectAllSessionsToBeReady();

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await connections.openConnectionPane();
		await layouts.resizeAuxiliaryBar({ x: -300 });

		// open the new-connection modal with PostgreSQL pre-selected
		await connections.initiateConnection('R', 'PostgreSQL');
		const modal = page.locator('.connections-new-connection-modal, .positron-modal-dialog-box').first();
		await expect(modal).toBeVisible();

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'test-files', 'my-project');
		await captureFullWindow(page, 'connections-pane-new-connection.png');
	});
});
