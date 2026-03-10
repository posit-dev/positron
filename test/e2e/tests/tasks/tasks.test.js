"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Tasks', {
    tag: [_test_setup_1.tags.TASKS]
}, () => {
    (0, _test_setup_1.test)('Python: Verify Basic Tasks Functionality', async function ({ app, python, openFile }) {
        await openFile((0, path_1.join)('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
        await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+B' : 'Control+Shift+B');
        await app.workbench.quickInput.waitForQuickInputOpened();
        await app.workbench.quickInput.selectQuickInputElementContaining('Run Python File');
        await app.workbench.quickInput.waitForQuickInputClosed();
        await app.workbench.terminal.waitForTerminalText('336776');
        await app.workbench.terminal.sendKeysToTerminal('Enter');
    });
    (0, _test_setup_1.test)('R: Verify Basic Tasks Functionality', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r, openFile }) {
        await openFile((0, path_1.join)('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));
        await app.code.driver.currentPage.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+B' : 'Control+Shift+B');
        await app.workbench.quickInput.waitForQuickInputOpened();
        await app.workbench.quickInput.selectQuickInputElementContaining('Run R File');
        await app.workbench.quickInput.waitForQuickInputClosed();
        await app.workbench.terminal.waitForTerminalText('336776');
        await app.workbench.terminal.sendKeysToTerminal('Enter');
    });
});
//# sourceMappingURL=tasks.test.js.map