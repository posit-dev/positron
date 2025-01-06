/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Markdown', { tag: [tags.WEB, tags.R_MARKDOWN] }, () => {
	test('Render R Markdown [C680618]', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));

		// Sometimes running render too quickly fails, saying pandoc is not installed.
		// Using expect.toPass allows it to retry.
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
			await app.workbench.terminal.waitForTerminalText('Output created: basicRmd.html');
		}).toPass({ timeout: 80000 });

		// Wrapped in expect.toPass to allow UI to update/render
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('basicRmd.html');
		}).toPass({ timeout: 80000 });

	});

	// test depends on the previous test
	test('Preview R Markdown [C709147]', async function ({ app, r }) {
		// Preview
		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');

		// inner most frame has no useful identifying features
		// not factoring this locator because its not part of positron
		const gettingStarted = app.workbench.viewer.getViewerFrame().frameLocator('iframe').locator('h2[data-anchor-id="getting-started"]');

		await expect(gettingStarted).toBeVisible({ timeout: 60000 });
		await expect(gettingStarted).toHaveText('Getting started');
	});
});
