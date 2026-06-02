/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Runtime Startup Diagnostics', {
	tag: [tags.SESSIONS, tags.WEB, tags.WIN]
}, () => {

	test.afterEach(async function ({ runCommand }) {
		await runCommand('workbench.action.closeAllEditors');
	});

	test('Diagnostics report renders past the Loading placeholder', async function ({ app, runCommand }) {
		await runCommand('positron.startupDiagnostics.show');

		// The content provider seeds the editor with "Loading..." and replaces it
		// once the report is built. If anything in the report build throws, the
		// editor stays stuck on the placeholder. Monaco virtualizes view-lines so
		// only on-screen content is in the DOM; pick two headers from the top of
		// the report and confirm they render.
		const viewLines = app.code.driver.currentPage.locator('.monaco-editor .view-lines');
		await expect(viewLines.getByText('Positron Runtime Startup Diagnostics', { exact: false })).toBeVisible({ timeout: 30000 });
		await expect(viewLines.getByText('System Information', { exact: false })).toBeVisible({ timeout: 30000 });
	});
});
