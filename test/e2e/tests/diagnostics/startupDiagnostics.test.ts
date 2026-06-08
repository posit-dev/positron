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

	test('Discovery Cache section is included in the report', async function ({ app, runCommand, hotKeys }) {
		const { clipboard } = app.workbench;

		await runCommand('positron.startupDiagnostics.show');

		// Wait for the report to render past the "Loading..." placeholder before
		// reading it; see the sibling test for why these two headers are used.
		const viewLines = app.code.driver.currentPage.locator('.monaco-editor .view-lines');
		await expect(viewLines.getByText('Positron Runtime Startup Diagnostics', { exact: false })).toBeVisible({ timeout: 30000 });

		// The "Discovery Cache" heading lives below the fold, and Monaco
		// virtualizes view-lines so off-screen text is not in the DOM. Select-all
		// + copy reads the full model regardless of what is rendered. This section
		// was silently dropped once by a bad upstream merge, so guard its presence.
		await viewLines.click();
		await hotKeys.selectAll();
		await clipboard.copy();

		await expect(async () => {
			const text = await clipboard.getClipboardText();
			expect(text).toContain('Discovery Cache');
		}).toPass({ timeout: 5000 });
	});
});
