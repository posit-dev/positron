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
_test_setup_1.test.describe('Console Output', { tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.CONSOLE, _test_setup_1.tags.WEB] }, () => {
    (0, _test_setup_1.test)('R - Ensure output to console in a loop with short pauses', {
        tag: [_test_setup_1.tags.ARK]
    }, async function ({ app, r }) {
        await app.workbench.console.pasteCodeToConsole(rCode);
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForConsoleContents('Why do programmers prefer dark mode');
        await app.workbench.console.waitForConsoleContents('Because light attracts bugs!');
    });
    (0, _test_setup_1.test)('Python - Ensure long console output wraps appropriately', async function ({ app, python }) {
        await app.workbench.console.waitForReady('>>>');
        await app.workbench.console.pasteCodeToConsole(pyCode);
        await app.workbench.console.sendEnterKey();
        await app.workbench.console.waitForReady('>>>');
        const el = app.workbench.console.activeConsole;
        (0, _test_setup_1.expect)(await el.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await el.evaluate((el) => el.clientWidth));
    });
});
const rCode = `tokens <- c(
	"",
	"Why",
	" do",
	" programmers",
	" prefer",
	" dark",
	" mode",
	"?\n\n",
	"Because",
	" light",
	" attracts",
	" bugs",
	"!"
	)

	for(token in tokens) {
		cat(token)
		Sys.sleep(0.01)
	}`;
const pyCode = `"Blah" * 300`;
//# sourceMappingURL=console-output.test.js.map