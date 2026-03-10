"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Editor = void 0;
const test_1 = __importStar(require("@playwright/test"));
// currently a dupe of declaration in ../editor.ts but trying not to modify that file
const EDITOR = (filename) => `.monaco-editor[data-uri$="${filename}"]`;
const CURRENT_LINE = '.view-overlays .current-line';
const PLAY_BUTTON = '.codicon-play';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const VIEW_LINES = (filename) => `${EDITOR(filename)} .view-lines`;
const LINE_NUMBERS = (filename) => `${EDITOR(filename)} .margin .margin-view-overlays .line-numbers`;
class Editor {
    code;
    get viewerFrame() { return this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME); }
    get playButton() { return this.code.driver.currentPage.locator(PLAY_BUTTON); }
    get editorPane() { return this.code.driver.currentPage.locator('[id="workbench.parts.editor"]'); }
    getEditorViewerFrame() {
        return this.viewerFrame;
    }
    constructor(code) {
        this.code = code;
    }
    /**
     * Wait for content to be visible in the editor viewer frame.
     */
    async expectEditorViewerContentVisible(getLocator, options) {
        const { timeout = 30000 } = options ?? {};
        const frame = !this.code.electronApp
            ? this.getEditorViewerFrame().frameLocator('iframe')
            : this.getEditorViewerFrame();
        await (0, test_1.expect)(getLocator(frame)).toBeVisible({ timeout });
    }
    /**
     * Action: Enter text in the editor
     * @param text the text to type into the editor
     * @param pressEnter whether to press Enter after typing the text
     */
    async type(text, pressEnter = false) {
        await this.editorPane.pressSequentially(text);
        if (pressEnter) {
            await this.editorPane.press('Enter');
        }
    }
    /** Action: Select tab by name
     * @param filename the name of the tab to select
     */
    async selectTab(filename) {
        await test_1.default.step(`Select tab ${filename}`, async () => {
            await this.code.driver.currentPage.getByRole('tab', { name: filename }).click();
        });
    }
    /**
     * Action: Select a file in the editor and enter text
     * @param filename the name of the file to select
     * @param text the text to type into the editor
     */
    async selectTabAndType(filename, text) {
        await test_1.default.step(`Select tab ${filename} and type text`, async () => {
            await this.selectTab(filename);
            await this.type(text);
        });
    }
    async pressPlay(skipToastVerification = false) {
        await test_1.default.step('Press play button', async () => {
            await this.code.driver.currentPage.locator(PLAY_BUTTON).click();
            if (!skipToastVerification) {
                // await appearance and disappearance of the toast
                const appRunningToast = this.code.driver.currentPage.locator('.notifications-toasts').getByText(/Running.*application:/);
                await (0, test_1.expect)(appRunningToast).toBeVisible({ timeout: 30000 });
                await (0, test_1.expect)(appRunningToast).not.toBeVisible({ timeout: 45000 });
            }
        });
    }
    async pressToLine(filename, lineNumber, press) {
        const editor = EDITOR(filename);
        const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;
        const lineLocator = this.code.driver.currentPage.locator(line);
        await lineLocator.press(press);
    }
    /**
     * This function returns the top value of the style attribute for the editor's current-line div
     * parent (the current-line div is a child of the div that has the top attribute). It retries up
     * to 10 times to get the value. Retries are necessary because the value is not always
     * immediately available (presumably due to the change from one current line to another).
     * @returns Promise that resolves to top value of the style attribute for the editor's
     * current-line div parent.
     */
    async getCurrentLineTop() {
        let retries = 20;
        let topValue = NaN;
        const currentLine = this.code.driver.currentPage.locator(CURRENT_LINE);
        // Note that '..' is used to get the parent of the current-line div
        const currentLineParent = currentLine.locator('..');
        // Note that this retry loop does not sleep.  This is because the
        // test that uses this function needs to run as quickly as possible
        // in order to verify that the editor is not executing code out of order.
        while (retries > 0) {
            const boundingBox = await currentLineParent.boundingBox();
            topValue = boundingBox?.y || NaN;
            if (!isNaN(topValue)) {
                break;
            }
            retries--;
        }
        return topValue;
    }
    async waitForEditorContents(filename, accept, selectorPrefix = '') {
        const selector = [selectorPrefix || '', `${EDITOR(filename)} .view-lines`].join(' ');
        const locator = this.code.driver.currentPage.locator(selector);
        let content = '';
        await (0, test_1.expect)(async () => {
            content = (await locator.textContent())?.replace(/\u00a0/g, ' ') || '';
            if (!accept(content)) {
                throw new Error(`Content did not match condition: ${content}`);
            }
        }).toPass();
        return content;
    }
    async waitForEditorFocus(filename, lineNumber, selectorPrefix = '') {
        const editor = [selectorPrefix || '', EDITOR(filename)].join(' ');
        const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;
        const editContext = `${editor} .native-edit-context`;
        await this.code.driver.currentPage.locator(line).click();
        await (0, test_1.expect)(async () => {
            await (0, test_1.expect)(this.code.driver.currentPage.locator(editContext)).toBeFocused();
        }).toPass();
    }
    async clickOnTerm(filename, term, line, doubleClick = false) {
        const selector = await this.getSelector(filename, term, line);
        const locator = this.code.driver.currentPage.locator(selector);
        doubleClick ? await locator.dblclick() : await locator.click();
        return locator;
    }
    async getSelector(filename, term, line) {
        const lineIndex = await this.getViewLineIndex(filename, line);
        // Get class names and the correct term index
        const { classNames, termIndex } = await this.getClassSelectors(filename, term, lineIndex);
        return `${VIEW_LINES(filename)}>:nth-child(${lineIndex}) span span.${classNames[0]}:nth-of-type(${termIndex + 1})`;
    }
    async getViewLineIndex(filename, line) {
        const allElements = await this.code.driver.currentPage.locator(LINE_NUMBERS(filename)).all();
        // Resolve textContent for all elements first
        const elementsWithText = await Promise.all(allElements.map(async (el, index) => ({
            el,
            text: await el.textContent(),
            index
        })));
        // Find the first element matching the line number
        const matchingElement = elementsWithText.find(({ text }) => text === `${line}`);
        if (!matchingElement) {
            throw new Error(`Line ${line} not found in file ${filename}`);
        }
        // Return the 1-based index
        return matchingElement.index + 1;
    }
    async getClassSelectors(filename, term, viewline) {
        // Locate all spans inside the line
        const allElements = await this.code.driver.currentPage.locator(`${VIEW_LINES(filename)}>:nth-child(${viewline}) span span`).all();
        // Resolve all textContent values before filtering
        const elementsWithText = await Promise.all(allElements.map(async (el, index) => ({
            el,
            text: (await el.textContent())?.trim(),
            index
        })));
        // Find the first element that contains the term
        const matchingElement = elementsWithText.find(({ text }) => text === term);
        if (!matchingElement) {
            throw new Error(`No elements found with term "${term}" in file "${filename}"`);
        }
        // Get the class names of the matching span
        const className = await matchingElement.el.evaluate(el => el.className);
        const classNames = className.split(/\s+/);
        // Find the index of this span among all spans
        const termIndex = elementsWithText.filter(({ text }) => text !== null).map(({ el }) => el).indexOf(matchingElement.el);
        return { classNames, termIndex };
    }
    async getLine(filename, line) {
        const lineIndex = await this.getViewLineIndex(filename, line);
        const lineContent = await this.editorPane.locator('div.view-line').nth(lineIndex - 1).textContent();
        return lineContent;
    }
    async replaceTerm(file, term, line, replaceWith) {
        await test_1.default.step(`Replace "${term}" on line ${line} with "${replaceWith}"`, async () => {
            await this.code.driver.currentPage.getByRole('tab', { name: file }).click();
            await this.clickOnTerm(file, term, line, true);
            await this.code.driver.currentPage.keyboard.type(replaceWith);
        });
    }
    async getMonacoFilenames() {
        const loc = this.code.driver.currentPage.locator('.monaco-editor[data-uri]');
        const uris = await loc.evaluateAll(els => els.map(el => el.getAttribute('data-uri') ?? ''));
        const names = uris
            .map(u => {
            // drop query/hash and decode
            const clean = decodeURIComponent(u.split('#')[0].split('?')[0]);
            // take last path-ish segment (handles file:///… , /…, untitled:…, etc.)
            const segs = clean.split(/[\\/:\u2215]/); // handle /, \, :
            return segs[segs.length - 1] || '';
        })
            .filter(Boolean);
        // if you only want unique filenames:
        return [...new Set(names)];
    }
}
exports.Editor = Editor;
//# sourceMappingURL=editor.js.map