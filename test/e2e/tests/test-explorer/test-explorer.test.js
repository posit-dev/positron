"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Test Explorer', { tag: [_test_setup_1.tags.TEST_EXPLORER, _test_setup_1.tags.WEB] }, () => {
    _test_setup_1.test.beforeAll(async function ({ app, settings, r, hotKeys }) {
        try {
            // don't use native file picker
            await settings.set({
                'files.simpleDialog.enable': true
            }, { reload: true, waitForReady: true });
        }
        catch (e) {
            await app.code.driver.takeScreenshot('testExplorerSetup');
            throw e;
        }
    });
    _test_setup_1.test.skip('R - Verify Basic Test Explorer Functionality', {
        tag: [_test_setup_1.tags.ARK],
        annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10682' }]
    }, async function ({ app, openFolder }) {
        // Open R package embedded in qa-example-content
        await openFolder(path.join('qa-example-content/workspaces/r_testing'));
        await app.workbench.sessions.expectAllSessionsToBeReady();
        await app.workbench.sessions.start('r');
        await (0, _test_setup_1.expect)(async () => {
            await app.workbench.testExplorer.openTestExplorer();
            await app.workbench.sessions.expectAllSessionsToBeReady();
            await app.workbench.testExplorer.verifyTestFilesExist(['test-mathstuff.R']);
        }).toPass({ timeout: 60000 });
        await app.workbench.testExplorer.runAllTests();
        await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
        await (0, _test_setup_1.expect)(async () => {
            const testResults = await app.workbench.testExplorer.getTestResults();
            (0, _test_setup_1.expect)(testResults[0].caseText).toBe('nothing really');
            (0, _test_setup_1.expect)(testResults[0].status).toBe('fail');
            (0, _test_setup_1.expect)(testResults[1].caseText).toBe('subtraction works');
            (0, _test_setup_1.expect)(testResults[1].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[2].caseText).toBe('subtraction `still` "works"');
            (0, _test_setup_1.expect)(testResults[2].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[3].caseText).toBe('x is \'a\'');
            (0, _test_setup_1.expect)(testResults[3].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[4].caseText).toBe('x is \'a\' AND y is \'b\'');
            (0, _test_setup_1.expect)(testResults[4].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[5].caseText).toBe('whatever');
            (0, _test_setup_1.expect)(testResults[5].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[6].caseText).toBe('can \'add\' two numbers');
            (0, _test_setup_1.expect)(testResults[6].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[7].caseText).toBe('can multiply two numbers');
            (0, _test_setup_1.expect)(testResults[7].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[8].caseText).toBe('can be multiplied by a scalar');
            (0, _test_setup_1.expect)(testResults[8].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[9].caseText).toBe('is true');
            (0, _test_setup_1.expect)(testResults[9].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[10].caseText).toBe('can add two numbers');
            (0, _test_setup_1.expect)(testResults[10].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[11].caseText).toBe('can multiply two numbers');
            (0, _test_setup_1.expect)(testResults[11].status).toBe('pass');
            (0, _test_setup_1.expect)(testResults[12].caseText).toBe('a second it()');
            (0, _test_setup_1.expect)(testResults[12].status).toBe('pass');
        }).toPass({ timeout: 50000 });
    });
});
//# sourceMappingURL=test-explorer.test.js.map