/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Markdown', { tag: [tags.WEB, tags.R_MARKDOWN, tags.ARK] }, () => {
	test.describe.configure({ mode: 'serial' }); // 2nd test depends on 1st test

	test('Verify can render R Markdown', async function ({ app, r }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));
		await app.positron.quickaccess.runCommand('r.rmarkdownRender');
		await app.positron.explorer.verifyExplorerFilesExist(['basicRmd.html']);
	});

	test('Verify can preview R Markdown', async function ({ app, r }) {
		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');

		// inner most frame has no useful identifying features
		// not factoring this locator because its not part of positron
		const gettingStarted = app.positron.viewer.viewerFrame.frameLocator('iframe').locator('h2[data-anchor-id="getting-started"]');

		await expect(gettingStarted).toBeVisible({ timeout: 60000 });
		await expect(gettingStarted).toHaveText('Getting started');
	});
});
