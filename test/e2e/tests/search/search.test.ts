/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
test.use({
	suiteId: __filename
});

test.describe('Search', {
	tag: [tags.SEARCH, tags.WEB, tags.WIN]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.search.clearSearchResults();
	});

	test('Verify Basic Search for Unique Strings', async function ({ app }) {
		await app.workbench.search.openSearchViewlet();
		await app.workbench.search.searchFor('unique-string');
		await app.workbench.search.waitForResultText('8 results in 2 files');
	});


	test('Verify Basic Search for Unique Strings with Extension Filter', async function ({ app }) {
		await app.workbench.search.openSearchViewlet();
		await app.workbench.search.showQueryDetails();

		await app.workbench.search.searchFor('unique-string');
		await app.workbench.search.setFilesToIncludeText('*.js');
		await app.workbench.search.waitForResultText('4 results in 1 file');
		await app.workbench.search.setFilesToIncludeText('');
		// skipping hideQueryDetails bc a tooltip often blocks the button making the step flaky
		// and this action isn't critical for the core assertions in this test
		// await app.workbench.search.hideQueryDetails();
	});

	test('Verify Basic Search for Unique Strings with File Removal', async function ({ app }) {
		await app.workbench.search.openSearchViewlet();
		await app.workbench.search.searchFor('unique-string');
		await app.workbench.search.waitForResultText('8 results in 2 files');
		await app.workbench.search.removeFileMatch('search-matches.txt');
		await app.workbench.search.waitForResultText('4 results in 1 file');
	});

});
