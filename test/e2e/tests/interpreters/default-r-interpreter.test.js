"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const default_interpreters_js_1 = require("./helpers/default-interpreters.js");
_test_setup_1.test.use({
    suiteId: __filename
});
// electron only for now - windows doesn't have hidden interpreters and for web the deletePositronHistoryFiles is not valid
_test_setup_1.test.describe('Default Interpreters - R', {
    tag: [_test_setup_1.tags.INTERPRETER, _test_setup_1.tags.ARK]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ settings }) {
        await settings.remove(['interpreters.startupBehavior']);
        await settings.set({ 'interpreters.startupBehavior': 'always' });
        await (0, default_interpreters_js_1.deletePositronHistoryFiles)();
        // local debugging sample:
        // await settings.set({'positron.r.interpreters.default': '/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources/R'}, { reload: true });
        const hiddenRVersion = process.env.POSITRON_HIDDEN_R;
        if (!hiddenRVersion) {
            throw new Error('POSITRON_HIDDEN_R environment variable is not set');
        }
        const rPath = `/root/scratch/R-${hiddenRVersion}/bin/R`;
        await settings.set({ 'positron.r.interpreters.default': rPath }, { reload: true });
    });
    _test_setup_1.test.afterAll(async function ({ cleanup }) {
        await cleanup.discardAllChanges();
    });
    (0, _test_setup_1.test)('R - Add a default interpreter', async function ({ runCommand, sessions, hotKeys }) {
        await hotKeys.reloadWindow(true);
        const hiddenRVersion = process.env.POSITRON_HIDDEN_R;
        if (!hiddenRVersion) {
            throw new Error('POSITRON_HIDDEN_R environment variable is not set');
        }
        // Escape dots for regex matching
        const escapedVersion = hiddenRVersion.replace(/\./g, '\\.');
        await (0, test_1.expect)(async () => {
            try {
                const { name, path } = await sessions.getMetadata();
                // Local debugging sample:
                // expect(name).toContain('R 4.3.3');
                // expect(path).toContain('R.framework/Versions/4.3-arm64/Resources/R');
                // hidden CI interpreter:
                (0, test_1.expect)(name).toMatch(new RegExp(`R ${escapedVersion}`));
                (0, test_1.expect)(path).toMatch(new RegExp(`R-${escapedVersion}\\/bin\\/R`));
            }
            catch (error) {
                await hotKeys.reloadWindow(true);
                throw error;
            }
        }).toPass({ timeout: 60000 });
    });
});
//# sourceMappingURL=default-r-interpreter.test.js.map