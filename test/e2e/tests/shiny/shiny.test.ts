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

	// No longer need to install Shiny extension

	test.afterEach(async function ({ app }) {
		await app.positron.terminal.sendKeysToTerminal('Control+C');
		await app.positron.viewer.refreshViewer();
	});

	test('Python - Verify Basic Shiny App', async function ({ app, python }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'shiny-py-example', 'app.py'));
		await app.positron.quickaccess.runCommand('shiny.python.runApp');
		const headerLocator = app.web
			? app.positron.viewer.viewerFrame.frameLocator('iframe').locator('h1')
			: app.positron.viewer.getViewerLocator('h1');

		await expect(async () => {
			await expect(headerLocator).toHaveText('Restaurant tipping', { timeout: 20000 });
		}).toPass({ timeout: 60000 });
	});

	test('R - Verify Basic Shiny App', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		const code = `library(shiny)
runExample("01_hello")`;
		await app.positron.console.pasteCodeToConsole(code);
		await app.positron.console.sendEnterKey();
		const headerLocator = app.web
			? app.positron.viewer.viewerFrame.frameLocator('iframe').locator('h1')
			: app.positron.viewer.getViewerLocator('h1');
		await expect(async () => {
			await expect(headerLocator).toHaveText('Hello Shiny!', { timeout: 20000 });
		}).toPass({ timeout: 60000 });
	});
});

