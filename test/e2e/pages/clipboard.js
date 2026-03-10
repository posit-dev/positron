"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Clipboard = void 0;
const test_1 = require("@playwright/test");
class Clipboard {
    code;
    hotKeys;
    constructor(code, hotKeys) {
        this.code = code;
        this.hotKeys = hotKeys;
    }
    async copy(timeoutMs = 5000) {
        const seed = '__SEED__';
        // Seed the clipboard
        await this.setClipboardText(seed);
        // Wait until clipboard value differs from the seed
        await test_1.expect
            .poll(async () => {
            await this.hotKeys.copy();
            return (await this.getClipboardText()) ?? '';
        }, {
            message: 'clipboard should change after copy',
            timeout: timeoutMs,
            intervals: [100, 150, 200, 300, 500, 800],
        })
            .not.toBe(seed);
    }
    async cut(timeoutMs = 5000) {
        const seed = '__SEED__';
        // Seed the clipboard
        await this.setClipboardText(seed);
        // Wait until clipboard value differs from the seed
        await this.hotKeys.cut();
        await test_1.expect
            .poll(async () => {
            return (await this.getClipboardText()) ?? '';
        }, {
            message: 'clipboard should change after cut',
            timeout: timeoutMs,
            intervals: [100, 150, 200, 300, 500, 800],
        })
            .not.toBe(seed);
    }
    async paste() {
        await this.hotKeys.paste();
    }
    async getClipboardText() {
        // Grant permissions to read from clipboard
        await this.code.driver.browserContext.grantPermissions(['clipboard-read']);
        const clipboardText = await this.code.driver.currentPage.evaluate(async () => {
            try {
                return await navigator.clipboard.readText();
            }
            catch (error) {
                console.error('Failed to read clipboard text:', error);
                return null;
            }
        });
        return clipboardText;
    }
    async expectClipboardTextToBe(expectedText, stripTrailingChar, { timeout = 20000 } = {}) {
        await (0, test_1.expect)(async () => {
            let clipboardText = await this.getClipboardText();
            if (clipboardText) {
                // Normalize line endings (Windows uses \r\n, but expected data uses \n)
                clipboardText = clipboardText.replace(/\r\n/g, '\n');
            }
            if (stripTrailingChar && clipboardText) {
                // Strip all trailing occurrences of the character, not just one
                while (clipboardText.endsWith(stripTrailingChar)) {
                    clipboardText = clipboardText.slice(0, -stripTrailingChar.length);
                }
            }
            (0, test_1.expect)(clipboardText).toBe(expectedText);
        }, { message: 'clipboard text to be...' }).toPass({ timeout });
    }
    async setClipboardText(text) {
        // Grant permissions to write to clipboard
        await this.code.driver.browserContext.grantPermissions(['clipboard-write']);
        // Use page context to set clipboard text
        await this.code.driver.currentPage.evaluate(async (textToCopy) => {
            try {
                await navigator.clipboard.writeText(textToCopy);
            }
            catch (error) {
                console.error('Failed to write text to clipboard:', error);
            }
        }, text);
    }
    async getClipboardImage() {
        // Grant permissions to read from clipboard
        await this.code.driver.browserContext.grantPermissions(['clipboard-read']);
        const clipboardImageBuffer = await this.code.driver.currentPage.evaluate(async () => {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                if (item.types.includes('image/png')) {
                    const blob = await item.getType('image/png');
                    const arrayBuffer = await blob.arrayBuffer();
                    return Array.from(new Uint8Array(arrayBuffer));
                }
            }
            return null;
        });
        return clipboardImageBuffer ? Buffer.from(clipboardImageBuffer) : null;
    }
    async clearClipboard() {
        // Grant permissions to modify the clipboard
        await this.code.driver.browserContext.grantPermissions(['clipboard-write']);
        // Use the page context to overwrite the clipboard
        await this.code.driver.currentPage.evaluate(async () => {
            await navigator.clipboard.writeText(''); // Clear clipboard by writing an empty string
        });
    }
}
exports.Clipboard = Clipboard;
//# sourceMappingURL=clipboard.js.map