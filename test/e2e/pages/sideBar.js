"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.SideBar = void 0;
const HIDE_SECONDARY_SIDE_BAR = '[aria-label^="Hide Secondary Side Bar"]';
const SESSION_BUTTON = '[aria-label="Session"]:has-text("Session")';
/*
 *  Reuseable Positron sidebar functionality for tests to leverage.
 */
class SideBar {
    code;
    constructor(code) {
        this.code = code;
    }
    async closeSecondarySideBar() {
        this.code.logger.log('Hiding secondary side bar');
        await this.code.driver.currentPage.locator(HIDE_SECONDARY_SIDE_BAR).click();
    }
    async openSession() {
        this.code.logger.log('Opening session');
        await this.code.driver.currentPage.locator(SESSION_BUTTON).click();
    }
}
exports.SideBar = SideBar;
//# sourceMappingURL=sideBar.js.map