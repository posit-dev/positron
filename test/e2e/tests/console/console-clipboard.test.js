"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
const testCases = [
    {
        language: 'python',
        testLine: 'a = 1',
        prompt: '>>>',
        restartRegex: /Python .+ restarted\./,
        extraTags: [],
    },
    {
        language: 'r',
        testLine: 'a <- 1',
        prompt: '>',
        restartRegex: /R .+ restarted\./,
        extraTags: [_test_setup_1.tags.ARK],
    },
];
_test_setup_1.test.describe('Console - Clipboard', { tag: [_test_setup_1.tags.CONSOLE, _test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.CROSS_BROWSER] }, () => {
    for (const { language, testLine, prompt, restartRegex, extraTags } of testCases) {
        (0, _test_setup_1.test)(`${language} - Verify copy from console & paste to console`, { tag: extraTags }, async ({ app, sessions, hotKeys }) => {
            const { console, clipboard } = app.workbench;
            // start a new session
            await sessions.start(language);
            // clear the console and wait for it to be ready
            await console.sendEnterKey();
            await console.clearButton.click();
            // type a line, select it, copy it, and paste it back into the console
            await console.typeToConsole(testLine);
            await hotKeys.selectAll();
            await hotKeys.copy();
            await console.sendEnterKey();
            await console.waitForConsoleExecution();
            await console.waitForConsoleContents(testLine);
            // clear the console, paste the copied line, and execute it
            await console.clearButton.click();
            // Pass text to clipboard.paste() for WebKit compatibility (uses synthetic paste event)
            await clipboard.paste(testLine);
            await console.waitForCurrentConsoleLineContents(testLine.replaceAll(' ', ' '));
            await console.sendEnterKey();
            await console.waitForConsoleExecution();
            await console.waitForConsoleContents(testLine);
        });
        (0, _test_setup_1.test)(`${language} - Verify copy from console & paste to console with context menu`, {
            tag: [_test_setup_1.tags.WEB_ONLY, ...extraTags],
        }, async ({ app, sessions }, testInfo) => {
            // Context menu clipboard tests don't work on Firefox or WebKit. Is this a bug?
            _test_setup_1.test.skip(testInfo.project.name.includes('firefox') || testInfo.project.name.includes('webkit'), 'Clipboard context menu not properly supported on Firefox/WebKit');
            // start a new session
            const { console, terminal } = app.workbench;
            await sessions.start(language);
            // clear the console and wait for it to be ready
            await console.clearButton.click();
            await console.restartButton.click();
            await console.waitForReady(prompt);
            // type a line, select it, copy it, and paste it back into the console
            await (0, _test_setup_1.expect)(async () => {
                await terminal.handleContextMenu(console.activeConsole, 'Select All');
                await app.code.wait(1000);
                await terminal.handleContextMenu(console.activeConsole, 'Copy');
                const clipboardText = await app.workbench.clipboard.getClipboardText();
                (0, _test_setup_1.expect)(clipboardText).toMatch(restartRegex);
            }).toPass({ timeout: 30000 });
        });
    }
});
//# sourceMappingURL=console-clipboard.test.js.map