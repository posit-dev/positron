"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Help = void 0;
const OUTER_FRAME = '.webview';
const MIDDLE_FRAME = '#active-frame';
const INNER_FRAME = '#help-iframe';
const HELP_CONTAINER = '.positron-help-container';
const RESIZE_SASH = '.monaco-sash.horizontal:not(.disabled)';
const AUX_BAR = '.part.auxiliarybar';
/*
 *  Reuseable Positron Help functionality for tests to leverage.
 */
class Help {
    code;
    get auxilaryBar() { return this.code.driver.currentPage.locator(AUX_BAR); }
    constructor(code) {
        this.code = code;
    }
    async openHelpPanel() {
        await this.code.driver.currentPage.locator('.action-label[aria-label="Help"]').click();
    }
    async getHelpWelcomePageFrame() {
        const outerFrame = this.code.driver.currentPage.locator(OUTER_FRAME).first().contentFrame();
        const innerInnerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
        return innerInnerFrame;
    }
    async getHelpFrame(nth) {
        const outerFrame = this.code.driver.currentPage.locator(OUTER_FRAME).nth(nth).contentFrame();
        const innerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
        const innerInnerFrame = innerFrame.frameLocator(INNER_FRAME);
        return innerInnerFrame;
    }
    getHelpContainer() {
        return this.auxilaryBar.locator(HELP_CONTAINER);
    }
    getHelpHeader() {
        return this.auxilaryBar.getByRole('button', { name: 'Help Section' });
    }
    async resizeHelpPanel(delta) {
        const sashLocator = this.auxilaryBar.locator(RESIZE_SASH);
        const sashLocation = await sashLocator.boundingBox();
        if (!sashLocation) {
            throw new Error('Could not find sash');
        }
        const middleOfSash = { x: sashLocation.x + sashLocation.width / 2, y: sashLocation.y + sashLocation.height / 2 };
        // Select the sash to resize
        await this.code.driver.clickAndDrag({
            from: middleOfSash,
            delta
        });
    }
}
exports.Help = Help;
//# sourceMappingURL=help.js.map