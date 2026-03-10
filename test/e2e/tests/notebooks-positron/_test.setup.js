"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.test = void 0;
const _test_setup_1 = require("../_test.setup");
exports.test = _test_setup_1.test.extend({
    enablePositronNotebooks: [true, { scope: 'worker', option: true }],
    beforeApp: [
        async ({ enablePositronNotebooks, settingsFile }, use) => {
            if (enablePositronNotebooks) {
                // Enable Positron notebooks before the app fixture starts
                // to avoid waiting for a window reload
                settingsFile.append({ 'positron.notebook.enabled': true });
            }
            await use();
        },
        { scope: 'worker' }
    ],
});
exports.test.afterEach(async function ({ hotKeys }) {
    await hotKeys.closeAllEditors();
});
//# sourceMappingURL=_test.setup.js.map