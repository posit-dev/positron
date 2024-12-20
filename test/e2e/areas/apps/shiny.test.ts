/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Shiny Application', { tag: [tags.APPS, tags.VIEWER, tags.WIN, tags.WEB] }, () => {
	test.beforeAll(async function ({ app }) {
		try {
			await app.workbench.positronExtensions.installExtension('posit.shiny', true);
			await app.workbench.positronExtensions.closeExtension('Shiny');
		} catch (e) {
			await app.code.driver.takeScreenshot('shinySetup');
			throw e;
		}
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');
		await app.workbench.positronViewer.refreshViewer();
	});

	test('Python - Verify Basic Shiny App [C699099]', async function ({ app, python }) {
		await app.workbench.positronQuickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));
		await app.workbench.positronQuickaccess.runCommand('shiny.python.runApp');
		const headerLocator = app.web
			? app.workbench.positronViewer.viewerFrame.frameLocator('iframe').locator('h1')
			: app.workbench.positronViewer.getViewerLocator('h1');

		await expect(async () => {
			await expect(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });
		}).toPass({ timeout: 60000 });
	});

	test('R - Verify Basic Shiny App [C699100]', async function ({ app, r }) {
		const code = `library(shiny)
runExample("01_hello")`;
		await app.workbench.positronConsole.pasteCodeToConsole(code);
		await app.workbench.positronConsole.sendEnterKey();
		const headerLocator = app.web
			? app.workbench.positronViewer.viewerFrame.frameLocator('iframe').locator('h1')
			: app.workbench.positronViewer.getViewerLocator('h1');
		await expect(async () => {
			await expect(headerLocator).toHaveText('Hello Shiny!', { timeout: 20000 });
		}).toPass({ timeout: 60000 });
	});
});

