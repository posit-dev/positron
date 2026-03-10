"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console Performance', {
    tag: [_test_setup_1.tags.SESSIONS, _test_setup_1.tags.CONSOLE, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    (0, _test_setup_1.test)('Python Performance - Console loads under 30 seconds', async ({ app, python, sessions }) => {
        const start = Date.now();
        await sessions.expectAllSessionsToBeReady();
        const end = Date.now();
        const loadTime = (end - start) / 1000;
        console.log(`Python Console load time: ${loadTime.toFixed(2)} seconds`);
        (0, test_1.expect)(loadTime).toBeLessThan(30);
    });
    (0, _test_setup_1.test)('R Performance - Console loads under 30 seconds', { tag: [_test_setup_1.tags.ARK] }, async ({ app, r, sessions }) => {
        const start = Date.now();
        await sessions.expectAllSessionsToBeReady();
        const end = Date.now();
        const loadTime = (end - start) / 1000;
        console.log(`R Console load time: ${loadTime.toFixed(2)} seconds`);
        (0, test_1.expect)(loadTime).toBeLessThan(30);
    });
});
//# sourceMappingURL=basic-performance.test.js.map