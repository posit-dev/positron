/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

const HEADING = 'Opened by browseURL';

// Writes a small HTML page from R and hands its path to browseURL(). Nothing in the
// workspace ships a rendered HTML file, and this keeps the test independent of asset content.
const BROWSE_HTML_FILE = [
	`html <- tempfile(fileext = ".html")`,
	`writeLines("<html><body><h1>${HEADING}</h1></body></html>", html)`,
	`browseURL(html)`,
].join('; ');

test.describe('browseURL', {
	tag: [tags.WORKBENCH, tags.ARK],
}, () => {

	// Regression test for #10893: on Workbench, browseURL() of a local file used to hand the
	// browser a vscode-remote:// URL it could not launch, so nothing happened.

	test('R browseURL opens a local HTML file in a new browser tab', async function ({ app, r, executeCode }) {
		const [htmlPage] = await Promise.all([
			app.code.driver.currentPage.context().waitForEvent('page', { timeout: 30000 }),
			executeCode('R', BROWSE_HTML_FILE),
		]);

		await htmlPage.waitForLoadState('domcontentloaded');
		await expect(htmlPage.getByRole('heading', { name: HEADING })).toBeVisible();
		await htmlPage.close();
	});
});
