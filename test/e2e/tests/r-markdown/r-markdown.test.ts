/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('R Markdown', { tag: [tags.WEB, tags.R_MARKDOWN, tags.ARK] }, () => {
	test.describe.configure({ mode: 'serial' }); // 2nd test depends on 1st test

	test('Verify can render R Markdown', async function ({ app, r }) {
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));
		await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
		// Do not pass `collapseFirst` here: render writes basicRmd.html next to its
		// source, inside workspaces/basic-rmd-file/, and collapsing the Explorer
		// folds nested rows out of the virtualized list entirely.
		await app.workbench.explorer.verifyExplorerFilesExist(['basicRmd.html']);
	});

	test('Verify can preview R Markdown', async function ({ app, r }) {
		await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');

		await app.workbench.viewer.expectContentVisible(
			content => content.locator('h2[data-anchor-id="getting-started"]', { hasText: 'Getting started' }),
			{ useIframe: true }
		);
	});
});
