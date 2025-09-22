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

	test.afterEach(async function ({ positron }) {
		await positron.search.clearSearchResults();
	});

	test('Verify Basic Search for Unique Strings', async function ({ positron }) {
		await positron.search.openSearchViewlet();
		await positron.search.searchFor('unique-string');
		await positron.search.waitForResultText('8 results in 2 files');
	});


	test('Verify Basic Search for Unique Strings with Extension Filter', async function ({ positron }) {
		await positron.search.openSearchViewlet();
		await positron.search.showQueryDetails();

		await positron.search.searchFor('unique-string');
		await positron.search.setFilesToIncludeText('*.js');
		await positron.search.waitForResultText('4 results in 1 file');
		await positron.search.setFilesToIncludeText('');
		await positron.search.hideQueryDetails();
	});

	test('Verify Basic Search for Unique Strings with File Removal', async function ({ positron }) {
		await positron.search.openSearchViewlet();
		await positron.search.searchFor('unique-string');
		await positron.search.waitForResultText('8 results in 2 files');
		await positron.search.removeFileMatch('search-matches.txt');
		await positron.search.waitForResultText('4 results in 1 file');
	});

});
