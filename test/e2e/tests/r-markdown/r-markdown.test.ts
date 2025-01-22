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
	test.describe.configure({ mode: 'serial' }); // 2nd test depends on 1st test

	test('Render R Markdown [C680618]', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));
		await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
		await app.workbench.explorer.verifyProjectFilesExist(['basicRmd.html']);
	});

	test('Preview R Markdown [C709147]', async function ({ app, r }) {
		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');

		// inner most frame has no useful identifying features
		// not factoring this locator because its not part of positron
		const gettingStarted = app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('h2[data-anchor-id="getting-started"]');

		await expect(gettingStarted).toBeVisible({ timeout: 60000 });
		await expect(gettingStarted).toHaveText('Getting started');
	});
});
