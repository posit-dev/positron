"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Search', {
    tag: [_test_setup_1.tags.SEARCH, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    _test_setup_1.test.afterEach(async function ({ app }) {
        await app.workbench.search.clearSearchResults();
    });
    (0, _test_setup_1.test)('Verify Basic Search for Unique Strings', async function ({ app }) {
        await app.workbench.search.openSearchViewlet();
        await app.workbench.search.searchFor('unique-string');
        await app.workbench.search.waitForResultText('8 results in 2 files');
    });
    (0, _test_setup_1.test)('Verify Basic Search for Unique Strings with Extension Filter', async function ({ app }) {
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
    (0, _test_setup_1.test)('Verify Basic Search for Unique Strings with File Removal', async function ({ app }) {
        await app.workbench.search.openSearchViewlet();
        await app.workbench.search.searchFor('unique-string');
        await app.workbench.search.waitForResultText('8 results in 2 files');
        await app.workbench.search.removeFileMatch('search-matches.txt');
        await app.workbench.search.waitForResultText('4 results in 1 file');
    });
});
//# sourceMappingURL=search.test.js.map