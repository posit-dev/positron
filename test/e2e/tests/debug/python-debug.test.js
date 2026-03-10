"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Python Debugging', {
    tag: [_test_setup_1.tags.DEBUG, _test_setup_1.tags.WEB, _test_setup_1.tags.WIN]
}, () => {
    (0, _test_setup_1.test)('Python - Verify Basic Script Debugging', async function ({ app, python, openFile }) {
        await _test_setup_1.test.step('Open file, set breakpoint and start debugging', async () => {
            await openFile((0, path_1.join)('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
            await app.workbench.debug.setBreakpointOnLine(6);
            await app.workbench.debug.startDebugging();
        });
        const requiredStrings = ["conn", "data_file_path", "os", "pd", "sqlite3"];
        await _test_setup_1.test.step('Validate initial variable set', async () => {
            await validateExpectedVariables(app, requiredStrings);
        });
        requiredStrings.push("cur");
        await _test_setup_1.test.step('Step over and validate variable set with new member', async () => {
            await app.workbench.debug.stepOver();
            await validateExpectedVariables(app, requiredStrings);
        });
        await _test_setup_1.test.step('Validate current stack', async () => {
            const stack = await app.workbench.debug.getStack();
            (0, test_1.expect)(stack[0]).toMatchObject({
                name: "chinook-sqlite.py",
                lineNumber: 7
            });
        });
        const internalRequiredStrings = ["columns", "copy", "data", "dtype", "index", "self"];
        await _test_setup_1.test.step('Step over twice, then into and validate internal variables', async () => {
            await app.workbench.debug.stepOver();
            await app.workbench.debug.stepOver();
            await app.workbench.debug.stepInto();
            await validateExpectedVariables(app, internalRequiredStrings);
        });
        // await test.step('Validate current internal stack', async () => {
        // 	const stack = await app.workbench.debug.getStack();
        // 	expect(stack[0]).toMatchObject({
        // 		name: "frame.py",
        // 		lineNumber: 702
        // 	});
        // 	expect(stack[1]).toMatchObject({
        // 		name: "chinook-sqlite.py",
        // 		lineNumber: 9
        // 	});
        // });
        await _test_setup_1.test.step('Step out, continue and wait completion', async () => {
            await app.workbench.debug.stepOut();
            await app.workbench.debug.continue();
            await (0, test_1.expect)(async () => {
                const stack = await app.workbench.debug.getStack();
                (0, test_1.expect)(stack.length).toBe(0);
            }).toPass({ intervals: [1_000], timeout: 60000 });
        });
    });
});
async function validateExpectedVariables(app, expectedVariables) {
    await (0, test_1.expect)(async () => {
        const variables = await app.workbench.debug.getVariables();
        expectedVariables.forEach(prefix => {
            (0, test_1.expect)(variables.some(line => line.startsWith(prefix))).toBeTruthy();
        });
    }).toPass({ intervals: [1_000], timeout: 60000 });
}
//# sourceMappingURL=python-debug.test.js.map