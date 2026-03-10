"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Extensions', {
    tag: [_test_setup_1.tags.EXTENSIONS, _test_setup_1.tags.WEB],
}, () => {
    (0, _test_setup_1.test)('Verify block of R extension installation', {
        tag: [_test_setup_1.tags.WEB_ONLY]
    }, async function ({ app }) {
        await app.workbench.extensions.installExtension('mikhail-arkhipov.r', false, true);
        await (0, test_1.expect)(app.code.driver.currentPage.getByLabel('DialogService: refused to show dialog in tests. Contents: Cannot install the \'R Tools\' extension because it conflicts with Positron built-in features').first()).toBeVisible();
    });
});
//# sourceMappingURL=blocked-installs.test.js.map