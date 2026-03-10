"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Console Output Log', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.OUTPUT, _test_setup_1.tags.CONSOLE] }, () => {
    _test_setup_1.test.beforeEach(async function ({ app }) {
        await app.workbench.layouts.enterLayout('stacked');
    });
    (0, _test_setup_1.test)('Python - Verify Console Output Log Contents', async function ({ app, python }) {
        const activeConsole = app.workbench.console.activeConsole;
        await activeConsole.click();
        await app.workbench.console.typeToConsole('a = b');
        await app.workbench.console.sendEnterKey();
        await app.workbench.output.clickOutputTab();
        await app.workbench.layouts.enterLayout('fullSizedPanel');
        await app.workbench.output.waitForOutContaining("name 'b' is not defined");
    });
    (0, _test_setup_1.test)('R - Verify Console Output Log Contents', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        const activeConsole = app.workbench.console.activeConsole;
        await activeConsole.click();
        await app.workbench.console.typeToConsole('a = b');
        await app.workbench.console.sendEnterKey();
        await app.workbench.output.clickOutputTab();
        await app.workbench.layouts.enterLayout('fullSizedPanel');
        await app.workbench.output.waitForOutContaining("object 'b' not found");
    });
});
//# sourceMappingURL=console-ouput-log.test.js.map